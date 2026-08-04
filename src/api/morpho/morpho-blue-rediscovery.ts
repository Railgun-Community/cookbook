import {
  Filter,
  Log,
  Provider,
  ZeroAddress,
  getAddress,
  zeroPadValue,
} from 'ethers';
import { RecipePositionKind } from '../../models/export-models';
import {
  MorphoBlueContract,
  MorphoBluePosition,
} from '../../contract/morpho/morpho-blue-contract';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import {
  MORPHO_BLUE_ADDRESS,
  MarketParams,
} from '../../steps/morpho/morpho-blue-util';
import {
  PositionOwner,
  resolvePositionOwnerAddressForRead,
} from '../../utils/7702';
import {
  MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0,
  MorphoBluePositionEvent,
  MorphoBluePositionEventName,
  decodeMorphoBluePositionLog,
  morphoBluePositionLogTopicFilters,
} from './morpho-blue-events';

// =============================================================================
// Rediscovery — finding positions with no local state.
//
// The premise of the whole EIP-7702 model is that the ephemeral account IS the
// position handle. A Blue position is not tokenized, so nothing is minted, no
// balance shows up in a wallet, and no ERC-20 or NFT enumeration will ever
// surface it. A consumer that loses its record of which derived account was used
// for which batch has lost the position: it keeps accruing interest and stays
// liquidatable by anyone, invisibly.
//
// This module is the recovery path. Given the accounts (which a consumer can
// always re-derive from its seed) and a block range, it answers what those
// accounts hold, reading nothing local.
//
// ## Two layers, because they cost different things
//
//   1. {@link scanMorphoBluePositionLogs} — two server-filtered `eth_getLogs`
//      per chunk. Answers *which `(market, owner)` pairs exist*. Cheap.
//   2. {@link rediscoverMorphoBluePositions} — the above, then one
//      `position(id, owner)` per pair pinned to `toBlock`, plus one
//      `idToMarketParams` + two `decimals()` per distinct *market* (markets are
//      far fewer than pairs). Answers *what those pairs hold now*.
//
// Layer 1 is never enough on its own, and the reason is worth stating plainly:
// logs report operations, not balances. Interest accrues with no per-position
// event; `Liquidate` moves a holder's words from a transaction the holder never
// sent; and anything before `fromBlock` is invisible. Summing log deltas into a
// balance is therefore wrong by an unbounded amount. Layer 2 exists so the
// authoritative number always comes from state.
//
// ## Read-failure policy (brief §9): never map a read error to zero
//
// A scanner that reports "empty" because a query failed is worse than one that
// reports nothing at all — it actively tells a user their position is closed.
// So this module distinguishes three outcomes everywhere, and makes a caller
// confront the third:
//
//   - a pair that reads as all-zero — genuinely closed
//   - a pair that reads as non-zero — held
//   - a range or pair that could NOT be read — counted in `unscanned` /
//     `unreadable`, never folded into either of the above
//
// {@link MorphoBlueRediscoveryReport.complete} is `false` whenever anything went
// unread, and {@link assertMorphoBlueRediscoveryComplete} turns that into a
// throw for callers that need certainty rather than a best effort.
//
// ## Relationship to `outputPositions` (the build-time channel)
//
// `RecipePositionInfo` and the types here answer the same question at opposite
// ends of a batch, and share vocabulary deliberately: `protocol`, `custody`,
// `marketOrPoolId`/`marketId`, `owner`, and `RecipePositionKind` mean exactly the
// same things, so a consumer can join a rediscovered position onto the record a
// recipe emitted.
//
// They are NOT the same type, and the divergence is deliberate — see
// {@link MorphoBlueRediscoveredPosition} for the three reasons.
// =============================================================================

/** A block range that could not be read. Never silently dropped. */
export type MorphoBlueUnscannedRange = {
  fromBlock: number;
  toBlock: number;
  reason: string;
};

/** A `(market, owner)` pair whose state read failed. Never silently dropped. */
export type MorphoBlueUnreadablePosition = {
  marketId: string;
  owner: string;
  reason: string;
};

/** One `(market, owner)` pair the logs say exists, with its provenance. */
export type MorphoBluePositionSighting = {
  protocol: 'morpho-blue';
  custody: 'address-bound';
  marketId: string;
  /** Checksummed. Blue's `onBehalf` (its `borrower`, on `Liquidate`). */
  owner: string;
  /**
   * Legs touched anywhere in the scanned range. This is *history*, not current
   * holdings — a leg opened and fully closed inside the window still appears
   * here. {@link MorphoBlueRediscoveredPosition.kinds} is the "holds now"
   * answer.
   */
  kinds: readonly RecipePositionKind[];
  /** Distinct event names observed, in first-seen order. */
  observedEvents: readonly MorphoBluePositionEventName[];
  firstSeenBlock: number;
  lastSeenBlock: number;
  /** How many position-moving logs matched this pair. */
  eventCount: number;
  /**
   * True when the pair was seen only via a `Liquidate` in which this account was
   * the `borrower`. Worth surfacing on its own: it means the position moved
   * without the holder acting, which is precisely the case a consumer relying on
   * its own transaction history would miss.
   */
  liquidatedInRange: boolean;
};

export type MorphoBluePositionLogScan = {
  fromBlock: number;
  toBlock: number;
  /** The resolved, checksummed accounts that were scanned for. */
  owners: readonly string[];
  sightings: readonly MorphoBluePositionSighting[];
  /** Every decoded log, in block/logIndex order. History, not balances. */
  events: readonly MorphoBluePositionEvent[];
  unscanned: readonly MorphoBlueUnscannedRange[];
  /**
   * `unscanned.length`, surfaced as its own field so a caller cannot render a
   * result without having seen it. Brief §9: never map a read error to zero.
   */
  unscannedCount: number;
  /** Total blocks inside `unscanned`. A range count alone understates a gap. */
  unscannedBlockCount: number;
  /** `unscanned.length === 0` — the whole requested range was actually read. */
  complete: boolean;
};

/**
 * Market metadata for a rediscovered position.
 *
 * A discriminated union rather than optional fields, so a consumer cannot read
 * `decimals` off a market whose descriptor failed to load and get `undefined`
 * where it expected a number. The position words are readable without any of
 * this, so a market read failing must not erase the position it belongs to.
 */
export type MorphoBlueRediscoveredMarket =
  | {
      readable: true;
      params: MarketParams;
      loanToken: string;
      loanDecimals: bigint;
      collateralToken: string;
      collateralDecimals: bigint;
    }
  | { readable: false; reason: string };

/**
 * A position the scan found and then confirmed against chain state.
 *
 * ## Why this is not a `RecipePositionInfo`
 *
 * The vocabulary is shared on purpose (`protocol`, `custody`, `owner`,
 * `RecipePositionKind`, and `marketId` is A7's `marketOrPoolId` for this
 * protocol) so the two join cleanly. The *shape* diverges in three places, each
 * because reusing A7's would state something false:
 *
 *  1. **No `direction`, and no `amount`.** A `RecipePositionInfo` is a signed
 *     delta a step is about to apply. This is a balance. Giving a balance a
 *     `direction` is meaningless, and — worse — putting it in an `amount` field
 *     whose siblings are deltas invites summing it into a delta ledger, which
 *     double-counts every position it touches.
 *  2. **Raw words, not one figure.** `supplyShares` and `borrowShares` are
 *     *shares*; converting either to assets needs the market totals rolled
 *     forward to a timestamp (`MorphoBlueAPI.getMarket` does it). Only
 *     `collateral` is already in native token units. Flattening the three into a
 *     single `amount: bigint` would put share- and asset-denominated numbers in
 *     one field with nothing to tell them apart — a unit lie, and the exact
 *     shape of bug the house rule about native-vs-raw exists to stop. Hand this
 *     to `MorphoBlueAPI.getPositionRisks` for accrued assets, LTV and health.
 *  3. **`kinds` is plural.** A7 emits one record per leg because a step moves one
 *     leg at a time. A rediscovered position is a whole account in a market and
 *     routinely holds collateral and debt at once; splitting it into per-leg
 *     records would lose the fact that they are one liquidatable unit.
 */
export type MorphoBlueRediscoveredPosition = {
  protocol: 'morpho-blue';
  custody: 'address-bound';
  marketId: string;
  /** Checksummed. Blue's `onBehalf` — the durable handle, not the receiver. */
  owner: string;

  /** `position(id, owner)` verbatim, read at {@link confirmedAtBlock}. */
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;

  /**
   * The legs that are non-zero **right now**. Empty for a position that was
   * found in the logs and has since been fully closed.
   */
  kinds: readonly RecipePositionKind[];
  /** True only when all three words are zero. */
  isEmpty: boolean;

  market: MorphoBlueRediscoveredMarket;

  /** Block the state read was pinned to. */
  confirmedAtBlock: number;
  /** How the pair was found. */
  sighting: MorphoBluePositionSighting;
};

export type MorphoBlueRediscoveryReport = {
  fromBlock: number;
  toBlock: number;
  owners: readonly string[];
  /**
   * Confirmed positions. By default only non-empty ones — pass
   * `includeEmpty: true` to keep pairs that were found in the logs and have
   * since closed.
   */
  positions: readonly MorphoBlueRediscoveredPosition[];
  /** Pairs the logs found but whose state read failed. */
  unreadable: readonly MorphoBlueUnreadablePosition[];
  unreadableCount: number;
  /** Block ranges whose `eth_getLogs` failed. */
  unscanned: readonly MorphoBlueUnscannedRange[];
  unscannedCount: number;
  unscannedBlockCount: number;
  /**
   * `unscanned.length === 0 && unreadable.length === 0`.
   *
   * **When this is `false`, `positions` is a lower bound, not an answer.** A
   * caller that renders "you hold nothing" off an incomplete report is doing the
   * exact thing brief §9 forbids.
   */
  complete: boolean;
  /** The log layer's own result, for callers that want the history too. */
  scan: MorphoBluePositionLogScan;
};

const DEFAULT_CHUNK_BLOCKS = 10_000;
const DEFAULT_CONCURRENCY = 8;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const resolveOwners = (owners: readonly PositionOwner[]): string[] => {
  if (owners.length === 0) {
    throw new Error(
      'morpho: rediscovery needs at least one owner — an unfiltered scan would return every Morpho Blue log on the chain',
    );
  }
  // The READ-path validator, deliberately. `resolvePositionOwnerAddress` (the
  // write path) rejects the relay-adapt address because booking a position
  // against shared custody strands it — but a position already stranded there is
  // exactly the one a rediscovery scan must be able to see. Refusing to look is
  // how it stays invisible.
  const resolved = owners.map(owner =>
    resolvePositionOwnerAddressForRead(owner, 'Morpho rediscovery owner'),
  );
  return [...new Set(resolved)];
};

const resolveBlockRange = async (params: {
  provider: Provider;
  fromBlock: number;
  toBlock?: number;
}): Promise<{ fromBlock: number; toBlock: number }> => {
  const { fromBlock } = params;
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(
      `morpho: fromBlock must be a non-negative integer (got ${fromBlock})`,
    );
  }
  let toBlock = params.toBlock;
  if (toBlock === undefined) {
    // Resolved to a concrete number rather than left as 'latest', so every
    // chunk and every state read below is pinned to one height. With 'latest'
    // the head moves under a long scan and the answer is a smear.
    toBlock = await params.provider.getBlockNumber();
  }
  if (!Number.isInteger(toBlock) || toBlock < 0) {
    throw new Error(
      `morpho: toBlock must be a non-negative integer (got ${toBlock})`,
    );
  }
  if (toBlock < fromBlock) {
    throw new Error(
      `morpho: toBlock ${toBlock} is before fromBlock ${fromBlock}`,
    );
  }
  return { fromBlock, toBlock };
};

/**
 * Layer 1: find every `(market, owner)` pair these accounts appear in.
 *
 * Two `eth_getLogs` per chunk, both fully server-filtered on indexed topics —
 * see `morpho-blue-events.ts` for why it is two and not one, and for the
 * false-positive trap that merging them creates.
 *
 * A chunk whose query fails is recorded in `unscanned` and the scan continues.
 * It is not retried here on purpose: a hidden retry turns a rate limit into a
 * long silent stall, and the recorded range is precise enough for the caller to
 * re-scan exactly what was missed.
 */
export const scanMorphoBluePositionLogs = async (params: {
  owners: readonly PositionOwner[];
  fromBlock: number;
  /** Defaults to the provider's current head, resolved once. */
  toBlock?: number;
  provider: Provider;
  /**
   * Blocks per `eth_getLogs`. Providers cap this (commonly 10k); lower it if a
   * scan starts landing in `unscanned` with a range error.
   */
  chunkBlocks?: number;
  /** The Blue singleton. Overridable for a fork or a test double. */
  morphoBlueAddress?: string;
}): Promise<MorphoBluePositionLogScan> => {
  const owners = resolveOwners(params.owners);
  const { fromBlock, toBlock } = await resolveBlockRange(params);
  const chunkBlocks = params.chunkBlocks ?? DEFAULT_CHUNK_BLOCKS;
  if (!Number.isInteger(chunkBlocks) || chunkBlocks < 1) {
    throw new Error(
      `morpho: chunkBlocks must be a positive integer (got ${chunkBlocks})`,
    );
  }
  const address = params.morphoBlueAddress ?? MORPHO_BLUE_ADDRESS;
  const topicFilters = morphoBluePositionLogTopicFilters(owners);

  const events: MorphoBluePositionEvent[] = [];
  const unscanned: MorphoBlueUnscannedRange[] = [];

  for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
    const end = Math.min(start + chunkBlocks - 1, toBlock);
    // Both filters for a chunk are issued together; if either fails the chunk is
    // unscanned, because a half-read chunk would drop whichever holder position
    // the failed query covered — silently, and asymmetrically by event.
    const results = await Promise.allSettled(
      topicFilters.map(topics =>
        params.provider.getLogs({
          address,
          fromBlock: start,
          toBlock: end,
          topics,
        } as Filter),
      ),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure !== undefined) {
      unscanned.push({
        fromBlock: start,
        toBlock: end,
        reason: errorMessage(failure.reason),
      });
      continue;
    }
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      for (const log of result.value as readonly Log[]) {
        const decoded = decodeMorphoBluePositionLog(log);
        if (decoded !== undefined) {
          events.push(decoded);
        }
      }
    }
  }

  events.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );

  const sightingsByKey = new Map<string, MorphoBluePositionSighting>();
  const kindsByKey = new Map<string, Set<RecipePositionKind>>();
  const namesByKey = new Map<string, MorphoBluePositionEventName[]>();
  for (const event of events) {
    const key = `${event.marketId}:${event.owner}`;
    const kinds = kindsByKey.get(key) ?? new Set<RecipePositionKind>();
    for (const kind of event.kinds) {
      kinds.add(kind);
    }
    kindsByKey.set(key, kinds);
    const names = namesByKey.get(key) ?? [];
    if (!names.includes(event.name)) {
      names.push(event.name);
    }
    namesByKey.set(key, names);

    const existing = sightingsByKey.get(key);
    if (existing === undefined) {
      sightingsByKey.set(key, {
        protocol: 'morpho-blue',
        custody: 'address-bound',
        marketId: event.marketId,
        owner: event.owner,
        kinds: [],
        observedEvents: [],
        firstSeenBlock: event.blockNumber,
        lastSeenBlock: event.blockNumber,
        eventCount: 1,
        liquidatedInRange: event.name === 'Liquidate',
      });
      continue;
    }
    sightingsByKey.set(key, {
      ...existing,
      lastSeenBlock: event.blockNumber,
      eventCount: existing.eventCount + 1,
      liquidatedInRange:
        existing.liquidatedInRange || event.name === 'Liquidate',
    });
  }

  const sightings = [...sightingsByKey.entries()].map(([key, sighting]) => ({
    ...sighting,
    kinds: [...(kindsByKey.get(key) ?? [])],
    observedEvents: namesByKey.get(key) ?? [],
  }));

  const unscannedBlockCount = unscanned.reduce(
    (total, range) => total + (range.toBlock - range.fromBlock + 1),
    0,
  );

  return {
    fromBlock,
    toBlock,
    owners,
    sightings,
    events,
    unscanned,
    unscannedCount: unscanned.length,
    unscannedBlockCount,
    complete: unscanned.length === 0,
  };
};

/**
 * Layer 2: confirm what the sighted pairs actually hold.
 *
 * One `position(id, owner)` per pair, pinned to the scan's `toBlock` so the
 * whole report is one snapshot rather than a smear across a moving head. Market
 * descriptors and token decimals are read once per distinct market and shared —
 * a scan over 40 accounts in 3 markets pays 3 market reads, not 40.
 *
 * A pair whose state read fails lands in `unreadable`, never in `positions` as a
 * zero. A market whose descriptor fails downgrades only that market's
 * `market.readable` to `false`; the position words still stand, because the
 * words are what says whether value is at risk and the decimals are decoration.
 *
 * Pinning needs an **archive** node for a `toBlock` outside the node's recent
 * window. That is the right failure: a pruning node rejects the read and the
 * pair lands in `unreadable`, rather than silently answering at a different
 * height.
 */
export const rediscoverMorphoBluePositions = async (params: {
  owners: readonly PositionOwner[];
  fromBlock: number;
  toBlock?: number;
  provider: Provider;
  chunkBlocks?: number;
  morphoBlueAddress?: string;
  /**
   * Keep pairs whose position is now all-zero. Off by default — a closed
   * position is not a holding — but useful for an audit view that wants to show
   * "this account used market X and has since exited".
   */
  includeEmpty?: boolean;
  /**
   * Max simultaneous `position()` reads. Bounded on purpose: firing one per pair
   * at once gets a large scan rate-limited, and a 429 is indistinguishable at
   * this layer from any other failed read — so it would land in `unreadable` and
   * inflate the very count this report exists to make trustworthy.
   */
  concurrency?: number;
}): Promise<MorphoBlueRediscoveryReport> => {
  const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `morpho: concurrency must be a positive integer (got ${concurrency})`,
    );
  }
  const scan = await scanMorphoBluePositionLogs(params);
  const blue = new MorphoBlueContract(
    params.morphoBlueAddress ?? MORPHO_BLUE_ADDRESS,
    params.provider,
  );

  const marketCache = new Map<string, Promise<MorphoBlueRediscoveredMarket>>();
  const readMarket = (
    marketId: string,
  ): Promise<MorphoBlueRediscoveredMarket> => {
    const cached = marketCache.get(marketId);
    if (cached !== undefined) {
      return cached;
    }
    const pending = (async (): Promise<MorphoBlueRediscoveredMarket> => {
      try {
        const marketParams = await blue.idToMarketParams(marketId);
        if (
          marketParams.loanToken === ZeroAddress &&
          marketParams.collateralToken === ZeroAddress
        ) {
          // `idToMarketParams` on an id that was never created returns five zero
          // words rather than reverting. A market id that came off a real log
          // cannot legitimately be uncreated, so this means the provider is on
          // the wrong chain (or pointed at the wrong singleton) — which would
          // also make every position read below meaningless.
          return {
            readable: false,
            reason: `market ${marketId} has an all-zero descriptor despite appearing in a log — the provider is on the wrong chain, or morphoBlueAddress is wrong`,
          };
        }
        const [loanDecimals, collateralDecimals] = await Promise.all([
          new ERC20Contract(marketParams.loanToken, params.provider).decimals(),
          new ERC20Contract(
            marketParams.collateralToken,
            params.provider,
          ).decimals(),
        ]);
        return {
          readable: true,
          params: marketParams,
          loanToken: marketParams.loanToken,
          loanDecimals,
          collateralToken: marketParams.collateralToken,
          collateralDecimals,
        };
      } catch (cause: unknown) {
        return { readable: false, reason: errorMessage(cause) };
      }
    })();
    marketCache.set(marketId, pending);
    return pending;
  };

  type PairResult =
    | { ok: true; position: MorphoBlueRediscoveredPosition }
    | { ok: false; failure: MorphoBlueUnreadablePosition };

  const confirmOne = async (
    sighting: MorphoBluePositionSighting,
  ): Promise<PairResult> => {
    let position: MorphoBluePosition;
    try {
      position = await blue.position(
        sighting.marketId,
        sighting.owner,
        scan.toBlock,
      );
    } catch (cause: unknown) {
      return {
        ok: false,
        failure: {
          marketId: sighting.marketId,
          owner: sighting.owner,
          reason: `position(${sighting.marketId}, ${sighting.owner}) @ block ${
            scan.toBlock
          }: ${errorMessage(cause)}`,
        },
      };
    }
    const market = await readMarket(sighting.marketId);
    const kinds: RecipePositionKind[] = [];
    if (position.collateral > 0n) {
      kinds.push('collateral');
    }
    if (position.borrowShares > 0n) {
      kinds.push('debt');
    }
    if (position.supplyShares > 0n) {
      kinds.push('supply');
    }
    return {
      ok: true,
      position: {
        protocol: 'morpho-blue',
        custody: 'address-bound',
        marketId: sighting.marketId,
        owner: sighting.owner,
        supplyShares: position.supplyShares,
        borrowShares: position.borrowShares,
        collateral: position.collateral,
        kinds,
        isEmpty:
          position.collateral === 0n &&
          position.borrowShares === 0n &&
          position.supplyShares === 0n,
        market,
        confirmedAtBlock: scan.toBlock,
        sighting,
      },
    };
  };

  const positions: MorphoBlueRediscoveredPosition[] = [];
  const unreadable: MorphoBlueUnreadablePosition[] = [];
  for (let i = 0; i < scan.sightings.length; i += concurrency) {
    const chunk = scan.sightings.slice(i, i + concurrency);
    const settled = await Promise.all(chunk.map(confirmOne));
    for (const result of settled) {
      if (!result.ok) {
        unreadable.push(result.failure);
      } else if (params.includeEmpty === true || !result.position.isEmpty) {
        positions.push(result.position);
      }
    }
  }

  return {
    fromBlock: scan.fromBlock,
    toBlock: scan.toBlock,
    owners: scan.owners,
    positions,
    unreadable,
    unreadableCount: unreadable.length,
    unscanned: scan.unscanned,
    unscannedCount: scan.unscannedCount,
    unscannedBlockCount: scan.unscannedBlockCount,
    complete: scan.unscanned.length === 0 && unreadable.length === 0,
    scan,
  };
};

/**
 * Throwing form of {@link MorphoBlueRediscoveryReport.complete}.
 *
 * Use it when "found nothing" has to mean "there is nothing" — a recovery flow
 * about to tell a user their funds are gone, for instance. A best-effort scan
 * that silently dropped a rate-limited chunk is not evidence of absence.
 */
export const assertMorphoBlueRediscoveryComplete = (
  report: MorphoBlueRediscoveryReport,
): MorphoBlueRediscoveryReport => {
  if (report.complete) {
    return report;
  }
  const gaps = report.unscanned
    .map(range => `${range.fromBlock}-${range.toBlock} (${range.reason})`)
    .join('; ');
  const pairs = report.unreadable
    .map(entry => `${entry.marketId}/${entry.owner} (${entry.reason})`)
    .join('; ');
  throw new Error(
    `morpho: rediscovery over blocks ${report.fromBlock}-${report.toBlock} is incomplete — ` +
      `${report.unscannedCount} unscanned range(s) covering ${report.unscannedBlockCount} block(s)` +
      `${gaps === '' ? '' : ` [${gaps}]`}, ` +
      `${report.unreadableCount} unreadable position(s)` +
      `${pairs === '' ? '' : ` [${pairs}]`}. ` +
      `The ${report.positions.length} position(s) found are a LOWER BOUND, not an answer. ` +
      `Re-scan the listed ranges before concluding anything about what these accounts hold.`,
  );
};

/**
 * One `setAuthorization` grant found in the logs.
 *
 * Rediscovery's second half, for the delegated case the owner/receiver split
 * makes expressible: when an executor acts for a durable owner, the *position*
 * is the owner's and a scan keyed on the executor finds nothing. This finds the
 * link instead — which owners a given executor may act for, or which executors
 * an owner has empowered.
 */
export type MorphoBlueAuthorizationEvent = {
  /** The account whose positions may be managed — Blue's `onBehalf`. */
  authorizer: string;
  /** The account granted (or revoked) the power to manage them. */
  authorized: string;
  /** `msg.sender` on the grant. Differs from `authorizer` on the sig path. */
  caller: string;
  /** The value set. A revocation emits the same event with `false`. */
  newIsAuthorized: boolean;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
};

export type MorphoBlueAuthorizationScan = {
  fromBlock: number;
  toBlock: number;
  /** The accounts scanned for, checksummed. */
  accounts: readonly string[];
  /** Every grant/revocation touching those accounts, in chain order. */
  events: readonly MorphoBlueAuthorizationEvent[];
  /**
   * Current state per `(authorizer, authorized)` pair, from the LAST event in
   * range. `true` entries are live grants **as far as this range shows** — a
   * grant made before `fromBlock` and never touched since is invisible here.
   * `MorphoBlueAPI.getAuthorization` is the authoritative read; this narrows
   * which pairs are worth asking about.
   */
  latest: readonly {
    authorizer: string;
    authorized: string;
    isAuthorized: boolean;
    blockNumber: number;
  }[];
  unscanned: readonly MorphoBlueUnscannedRange[];
  unscannedCount: number;
  unscannedBlockCount: number;
  complete: boolean;
};

/**
 * Scan `SetAuthorization` for a set of accounts, in either or both roles.
 *
 * All three of its addresses are indexed, so each role is one server-filtered
 * query; asking for both costs two.
 *
 * @param role Which side the supplied accounts sit on. `'authorized'` answers
 *   "whose positions may these executors manage"; `'authorizer'` answers "who
 *   have these owners empowered"; `'either'` runs both.
 */
export const scanMorphoBlueAuthorizations = async (params: {
  accounts: readonly PositionOwner[];
  role?: 'authorizer' | 'authorized' | 'either';
  fromBlock: number;
  toBlock?: number;
  provider: Provider;
  chunkBlocks?: number;
  morphoBlueAddress?: string;
}): Promise<MorphoBlueAuthorizationScan> => {
  const accounts = resolveOwners(params.accounts);
  const { fromBlock, toBlock } = await resolveBlockRange(params);
  const chunkBlocks = params.chunkBlocks ?? DEFAULT_CHUNK_BLOCKS;
  if (!Number.isInteger(chunkBlocks) || chunkBlocks < 1) {
    throw new Error(
      `morpho: chunkBlocks must be a positive integer (got ${chunkBlocks})`,
    );
  }
  const address = params.morphoBlueAddress ?? MORPHO_BLUE_ADDRESS;
  const role = params.role ?? 'either';
  const padded = accounts.map(account => zeroPadValue(account, 32));
  // topics: [SetAuthorization, caller, authorizer, authorized]
  const topicFilters: (string | string[] | null)[][] = [];
  if (role === 'authorizer' || role === 'either') {
    topicFilters.push([
      MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0,
      null,
      padded,
      null,
    ]);
  }
  if (role === 'authorized' || role === 'either') {
    topicFilters.push([
      MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0,
      null,
      null,
      padded,
    ]);
  }

  const events: MorphoBlueAuthorizationEvent[] = [];
  const unscanned: MorphoBlueUnscannedRange[] = [];
  const seen = new Set<string>();

  for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
    const end = Math.min(start + chunkBlocks - 1, toBlock);
    const results = await Promise.allSettled(
      topicFilters.map(topics =>
        params.provider.getLogs({
          address,
          fromBlock: start,
          toBlock: end,
          topics,
        } as Filter),
      ),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure !== undefined) {
      unscanned.push({
        fromBlock: start,
        toBlock: end,
        reason: errorMessage(failure.reason),
      });
      continue;
    }
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }
      for (const log of result.value as readonly Log[]) {
        // `role: 'either'` runs two filters that both match a self-grant, so
        // dedupe by log identity before decoding.
        const key = `${log.transactionHash}:${log.index}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        events.push(decodeAuthorizationLog(log));
      }
    }
  }

  events.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex,
  );

  const latestByPair = new Map<
    string,
    {
      authorizer: string;
      authorized: string;
      isAuthorized: boolean;
      blockNumber: number;
    }
  >();
  for (const event of events) {
    latestByPair.set(`${event.authorizer}:${event.authorized}`, {
      authorizer: event.authorizer,
      authorized: event.authorized,
      isAuthorized: event.newIsAuthorized,
      blockNumber: event.blockNumber,
    });
  }

  const unscannedBlockCount = unscanned.reduce(
    (total, range) => total + (range.toBlock - range.fromBlock + 1),
    0,
  );

  return {
    fromBlock,
    toBlock,
    accounts,
    events,
    latest: [...latestByPair.values()],
    unscanned,
    unscannedCount: unscanned.length,
    unscannedBlockCount,
    complete: unscanned.length === 0,
  };
};

const decodeAuthorizationLog = (
  log: Pick<
    Log,
    'topics' | 'data' | 'blockNumber' | 'transactionHash' | 'index'
  >,
): MorphoBlueAuthorizationEvent => {
  const [, callerTopic, authorizerTopic, authorizedTopic] = log.topics;
  if (
    callerTopic === undefined ||
    authorizerTopic === undefined ||
    authorizedTopic === undefined
  ) {
    throw new Error(
      'morpho: SetAuthorization log is missing indexed topics — refusing to drop an authorization sighting',
    );
  }
  // Plain `getAddress`, NOT a recipient validator. A topic is already a
  // well-formed 20-byte value, and `setAuthorization(address(0), ...)` is a call
  // the chain accepts — so validating here would let one odd log abort an entire
  // scan. A reader reads what is there.
  const addressOf = (topic: string): string =>
    getAddress(`0x${topic.slice(26)}`);
  return {
    caller: addressOf(callerTopic),
    authorizer: addressOf(authorizerTopic),
    authorized: addressOf(authorizedTopic),
    // Single non-indexed `bool`, ABI-encoded as one 32-byte word.
    newIsAuthorized: BigInt(log.data) !== 0n,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,
  };
};
