import {
  Contract,
  Filter,
  Interface,
  InterfaceAbi,
  Log,
  Provider,
  ZeroAddress,
  getAddress,
  zeroPadValue,
} from 'ethers';
import { NFTTokenType } from '@railgun-community/shared-models';
import { abi } from '../../../abi/abi';
import { assertValidRecipientAddress } from '../../../utils/address';
import {
  FX_POOL_ABI,
  KNOWN_POOLS,
  fxPositionTokenSubID,
  resolvePool,
  type Address,
  type FxMintPoolName,
  type FxMintPoolRef,
  type FxPoolSide,
} from '../../../steps/borrow/fx/fx-mint-util';

// =============================================================================
// Rediscovery for BEARER positions — f(x).
//
// Same problem as Morpho Blue, different handle. A Blue position is keyed by an
// account; an f(x) position is an ERC-721 token, and each `Pool` **is its own
// NFT contract** — `pool.address` is both the venue and the collection. So the
// ERC-721 `Transfer` fragment does here exactly what the seven Blue position
// events do there: it is the on-chain trail back to a position whose local
// record was lost.
//
// ## Logs are the ONLY enumeration path here
//
// Verified on mainnet: all four shipped pools answer `supportsInterface` `true`
// for ERC-721 (`0x80ac58cd`) and ERC-721 Metadata (`0x5b5e139f`), and **`false`
// for ERC-721 Enumerable** (`0x780e9d63`). There is no `tokenOfOwnerByIndex`,
// so `balanceOf` can tell you an account holds three positions and nothing on
// chain will tell you *which*. Without a `Transfer` scan a lost id is
// unrecoverable short of brute-forcing `ownerOf` over every id up to
// `getNextPositionId()`.
//
// ## Everything is indexed, so this is one cheap query per pool
//
// `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
// spends all three topic slots. Verified against live logs on all four pools:
// four topics, zero data bytes. Both directions are therefore server-filterable,
// and unlike Blue there is no split-layout problem — `from` is always topic1 and
// `to` is always topic2. Two queries per pool per chunk (in and out), not
// because the layout forces it but because they are different questions.
//
// ## The result a RAILGUN consumer must not misread
//
// For a shielded flow the expected end state is that the ephemeral executor does
// **not** own the NFT: `operate()` mints to `msg.sender`, then the shield leg
// moves it to the RAILGUN proxy, which is owner of record for every shielded
// fx position. A reader that returned only "tokens these accounts hold now"
// would therefore report *nothing* on the successful path — the §9 failure mode
// one level up.
//
// So this reader reports the current owner of every token it discovers, and
// classifies rather than filters. {@link FxRediscoveredPosition.custodyStatus}
// is the field that says which of those two worlds a token is in.
//
// ## Two reads, and what each can and cannot say
//
//  - `ownerOf(tokenId)` — the ownership authority. It **reverts** for an id that
//    was never minted (measured on ids past `getNextPositionId()`), so it is
//    also an existence check.
//  - `getPosition(tokenId)` — returns `(rawColls, rawDebts)`, and returns
//    **`(0, 0)` for an id that does not exist** rather than reverting (measured
//    on id 999999). It is therefore useless as an existence check, and is used
//    here only to say whether an already-proven token is empty. This is the same
//    trap `getPositionDebtRatio` has (brief §4.5) one function over.
//
// Measured: f(x) does not burn on close. Across 80,000 blocks of `wstETH-Long`
// transfers there were mints and no burns, and `getPosition` on a closed id
// returns `(0, 0)` with `ownerOf` still answering. A closed fx position is a
// live NFT holding nothing, not a destroyed one — so `ownerOf` reverting for an
// id that appeared in a `Transfer` log means the provider is on the wrong chain,
// not that the position was closed. A `to == address(0)` transfer is still
// classified as a burn, so the reader stays correct if that ever changes.
//
// ## Relationship to `outputPositions`
//
// `RecipeBearerPosition` (build time) and {@link FxRediscoveredPosition} (after
// the fact) share the NFT identity triple verbatim — `nftAddress`, `tokenSubID`
// (via the same `fxPositionTokenSubID`) and `nftTokenType` — so the two join on
// `nftIdentityKey`. They diverge in the same places the Blue pair does: no
// `direction` and no `amount`, because this is a state reading rather than a
// delta a step is about to apply, and `rawColls`/`rawDebts` are f(x)-internal
// units that need the pool descriptor to become native amounts
// (`getFxPosition` does that conversion).
// =============================================================================

const erc721Interface = new Interface(abi.token.erc721 as InterfaceAbi);

const transferFragment = erc721Interface.getEvent('Transfer');
/* istanbul ignore next -- the bundled ERC-721 ABI declares Transfer. */
if (transferFragment === null) {
  throw new Error('fxmint: bundled ERC-721 ABI has no Transfer event');
}

/**
 * `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`.
 *
 * Taken from the ABI this package already ships (`abi.token.erc721`) rather than
 * redeclared, so there is one definition of the fragment that both the write
 * path and this reader use.
 */
export const ERC721_TRANSFER_EVENT_FRAGMENT = transferFragment;

/** `topics[0]` of the ERC-721 `Transfer` event. */
export const ERC721_TRANSFER_TOPIC0 = transferFragment.topicHash;

/** A block range whose `eth_getLogs` failed. Never silently dropped. */
export type FxUnscannedRange = {
  /** The pool the failed query covered. */
  pool: Address;
  fromBlock: number;
  toBlock: number;
  reason: string;
};

/** A discovered token whose confirming read failed. Never silently dropped. */
export type FxUnreadablePosition = {
  pool: Address;
  positionId: bigint;
  reason: string;
};

/** One `(pool, positionId)` pair the transfer logs say the accounts touched. */
export type FxPositionSighting = {
  protocol: 'fx';
  custody: 'bearer';
  /** The pool, which is also the NFT contract. */
  pool: Address;
  poolName?: FxMintPoolName;
  side: FxPoolSide;
  /** Same triple `RecipeBearerPosition` carries, so the two join. */
  nftAddress: Address;
  tokenSubID: string;
  nftTokenType: NFTTokenType;
  positionId: bigint;

  /** True when a scanned account received the token in range (mint counts). */
  receivedInRange: boolean;
  /** True when a scanned account sent the token away in range. */
  sentInRange: boolean;
  /** True when the token was minted to a scanned account in range. */
  mintedInRange: boolean;
  firstSeenBlock: number;
  lastSeenBlock: number;
  transferCount: number;
};

export type FxPositionTransferScan = {
  fromBlock: number;
  toBlock: number;
  accounts: readonly string[];
  pools: readonly Address[];
  sightings: readonly FxPositionSighting[];
  unscanned: readonly FxUnscannedRange[];
  unscannedCount: number;
  unscannedBlockCount: number;
  complete: boolean;
};

/**
 * Where a discovered token sits now.
 *
 * - `held` — one of the scanned accounts owns it. For a 7702 flow this means
 *   the position was minted and **never shielded**, which is the stranded case
 *   from brief §4.1.
 * - `elsewhere` — someone else owns it. On a RAILGUN flow this is the ordinary
 *   success state: the shield leg moved it to the proxy. Read
 *   {@link FxRediscoveredPosition.currentOwner} before treating it as a loss.
 * - `burned` — owned by `address(0)`. Not observed on f(x) today; handled so the
 *   reader stays correct if it ever is.
 */
export type FxPositionCustodyStatus = 'held' | 'elsewhere' | 'burned';

export type FxRediscoveredPosition = {
  protocol: 'fx';
  custody: 'bearer';
  pool: Address;
  poolName?: FxMintPoolName;
  side: FxPoolSide;
  nftAddress: Address;
  tokenSubID: string;
  nftTokenType: NFTTokenType;
  positionId: bigint;

  /** `ownerOf(positionId)` at {@link confirmedAtBlock}, checksummed. */
  currentOwner: string;
  custodyStatus: FxPositionCustodyStatus;

  /**
   * `Pool.getPosition(positionId)` verbatim — f(x)-INTERNAL units.
   *
   * `rawDebts` is 18dp-normalised, so on `WBTC-Short` it is 10^10 times the
   * native WBTC figure; `rawColls` is scaled by `collateralBalance /
   * totalRawColls`. Neither is displayable. `getFxPosition` converts both, and
   * is the reader to hand these to. They are surfaced raw here rather than
   * converted because conversion costs three more reads per position and a
   * rediscovery scan is answering "what exists", not "what is it worth".
   */
  rawColls: bigint;
  rawDebts: bigint;
  /** `rawColls === 0n && rawDebts === 0n` — closed, but still a live NFT. */
  isEmpty: boolean;

  confirmedAtBlock: number;
  sighting: FxPositionSighting;
};

export type FxRediscoveryReport = {
  fromBlock: number;
  toBlock: number;
  accounts: readonly string[];
  pools: readonly Address[];
  /**
   * Every discovered position, whoever owns it now. Filter on `custodyStatus` —
   * do NOT assume `positions.length === 0` means the accounts never opened one;
   * check {@link complete} first.
   */
  positions: readonly FxRediscoveredPosition[];
  unreadable: readonly FxUnreadablePosition[];
  unreadableCount: number;
  unscanned: readonly FxUnscannedRange[];
  unscannedCount: number;
  unscannedBlockCount: number;
  /** `unscanned.length === 0 && unreadable.length === 0`. */
  complete: boolean;
  scan: FxPositionTransferScan;
};

const DEFAULT_CHUNK_BLOCKS = 10_000;
const DEFAULT_CONCURRENCY = 8;

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const resolveAccounts = (accounts: readonly string[]): string[] => {
  if (accounts.length === 0) {
    throw new Error(
      'fxmint: rediscovery needs at least one account — an unfiltered scan would return every f(x) position transfer on the chain',
    );
  }
  return [
    ...new Set(
      accounts.map(account => {
        // The CANONICAL validator, deliberately — not `assertValidExecutorAddress`.
        // That one rejects the relay-adapt contract, which is right when routing
        // value and wrong here: the relay adapter is the owner of record for
        // every *shielded* f(x) position, so it is the single account a bearer
        // scan is most likely to be pointed at. Same reasoning as
        // `resolvePositionOwnerAddressForRead` on the Blue side.
        //
        // It also puts a named error in front of ethers' bare
        // `bad address checksum`, which otherwise surfaces from inside a scan
        // with no indication of which input was malformed.
        assertValidRecipientAddress(account, 'f(x) rediscovery account');
        return getAddress(account);
      }),
    ),
  ];
};

const resolveBlockRange = async (params: {
  provider: Provider;
  fromBlock: number;
  toBlock?: number;
}): Promise<{ fromBlock: number; toBlock: number }> => {
  const { fromBlock } = params;
  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(
      `fxmint: fromBlock must be a non-negative integer (got ${fromBlock})`,
    );
  }
  const toBlock = params.toBlock ?? (await params.provider.getBlockNumber());
  if (!Number.isInteger(toBlock) || toBlock < 0) {
    throw new Error(
      `fxmint: toBlock must be a non-negative integer (got ${toBlock})`,
    );
  }
  if (toBlock < fromBlock) {
    throw new Error(
      `fxmint: toBlock ${toBlock} is before fromBlock ${fromBlock}`,
    );
  }
  return { fromBlock, toBlock };
};

/**
 * Layer 1: find every `(pool, positionId)` these accounts touched.
 *
 * Two `eth_getLogs` per pool per chunk — one for tokens moving IN to a scanned
 * account, one for tokens moving OUT. Both fully server-filtered; `Transfer`
 * indexes all three of its parameters.
 *
 * A failed chunk is recorded in `unscanned` and the scan continues, per pool, so
 * one flaky pool does not erase the others.
 */
export const scanFxPositionTransfers = async (params: {
  accounts: readonly string[];
  fromBlock: number;
  /** Defaults to the provider's current head, resolved once. */
  toBlock?: number;
  provider: Provider;
  /** Defaults to every pool in `KNOWN_POOLS`. */
  pools?: readonly FxMintPoolRef[];
  chunkBlocks?: number;
}): Promise<FxPositionTransferScan> => {
  const accounts = resolveAccounts(params.accounts);
  const { fromBlock, toBlock } = await resolveBlockRange(params);
  const chunkBlocks = params.chunkBlocks ?? DEFAULT_CHUNK_BLOCKS;
  if (!Number.isInteger(chunkBlocks) || chunkBlocks < 1) {
    throw new Error(
      `fxmint: chunkBlocks must be a positive integer (got ${chunkBlocks})`,
    );
  }
  const poolRefs: readonly FxMintPoolRef[] =
    params.pools ?? KNOWN_POOLS.map(pool => pool.name);
  const pools = poolRefs.map(ref => ({
    resolved: resolvePool(ref),
    name: typeof ref === 'string' ? ref : undefined,
  }));

  const padded = accounts.map(account => zeroPadValue(account, 32));
  const unscanned: FxUnscannedRange[] = [];
  const sightingsByKey = new Map<string, FxPositionSighting>();
  // A transfer BETWEEN two scanned accounts matches both the outgoing and the
  // incoming filter, so the same log arrives twice. Without this it would be
  // counted twice in `transferCount` — a reported number that is simply wrong,
  // and wrong precisely for the multi-executor case this reader exists to serve.
  const seenLogs = new Set<string>();

  for (const { resolved, name } of pools) {
    for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
      const end = Math.min(start + chunkBlocks - 1, toBlock);
      const topicFilters: (string | string[] | null)[][] = [
        [ERC721_TRANSFER_TOPIC0, padded, null, null],
        [ERC721_TRANSFER_TOPIC0, null, padded, null],
      ];
      const results = await Promise.allSettled(
        topicFilters.map(topics =>
          params.provider.getLogs({
            address: resolved.address,
            fromBlock: start,
            toBlock: end,
            topics,
          } as Filter),
        ),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (failure !== undefined) {
        // A half-read chunk would drop one direction, which is worse than
        // declaring the whole chunk unread: a token seen leaving but not
        // arriving reads as a position the account never had.
        unscanned.push({
          pool: resolved.address,
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
          const logKey = `${log.transactionHash}:${log.index}`;
          if (seenLogs.has(logKey)) {
            continue;
          }
          seenLogs.add(logKey);
          const [, fromTopic, toTopic, idTopic] = log.topics;
          if (
            fromTopic === undefined ||
            toTopic === undefined ||
            idTopic === undefined
          ) {
            throw new Error(
              `fxmint: Transfer log at ${log.transactionHash}:${log.index} is missing indexed topics — refusing to drop a position sighting`,
            );
          }
          const from = getAddress(`0x${fromTopic.slice(26)}`);
          const to = getAddress(`0x${toTopic.slice(26)}`);
          const positionId = BigInt(idTopic);
          const key = `${resolved.address}:${positionId.toString()}`;
          const isIncoming = accounts.includes(to);
          const isOutgoing = accounts.includes(from);
          const existing = sightingsByKey.get(key);
          if (existing === undefined) {
            sightingsByKey.set(key, {
              protocol: 'fx',
              custody: 'bearer',
              pool: resolved.address,
              ...(name === undefined ? {} : { poolName: name }),
              side: resolved.side,
              nftAddress: resolved.address,
              tokenSubID: fxPositionTokenSubID(positionId),
              nftTokenType: NFTTokenType.ERC721,
              positionId,
              receivedInRange: isIncoming,
              sentInRange: isOutgoing,
              mintedInRange: isIncoming && from === ZeroAddress,
              firstSeenBlock: log.blockNumber,
              lastSeenBlock: log.blockNumber,
              transferCount: 1,
            });
            continue;
          }
          sightingsByKey.set(key, {
            ...existing,
            receivedInRange: existing.receivedInRange || isIncoming,
            sentInRange: existing.sentInRange || isOutgoing,
            mintedInRange:
              existing.mintedInRange || (isIncoming && from === ZeroAddress),
            firstSeenBlock: Math.min(existing.firstSeenBlock, log.blockNumber),
            lastSeenBlock: Math.max(existing.lastSeenBlock, log.blockNumber),
            transferCount: existing.transferCount + 1,
          });
        }
      }
    }
  }

  const sightings = [...sightingsByKey.values()].sort(
    (a, b) =>
      a.pool.localeCompare(b.pool) || (a.positionId < b.positionId ? -1 : 1),
  );

  const unscannedBlockCount = unscanned.reduce(
    (total, range) => total + (range.toBlock - range.fromBlock + 1),
    0,
  );

  return {
    fromBlock,
    toBlock,
    accounts,
    pools: pools.map(pool => pool.resolved.address),
    sightings,
    unscanned,
    unscannedCount: unscanned.length,
    unscannedBlockCount,
    complete: unscanned.length === 0,
  };
};

/**
 * Layer 2: confirm who owns each discovered token and whether it holds anything.
 *
 * Two reads per token — `ownerOf` and `getPosition` — both pinned to the scan's
 * `toBlock` so the report is one snapshot. A token whose reads fail lands in
 * `unreadable`; it is never reported as unowned or as empty, because both of
 * those are claims and a failed read is not.
 */
export const rediscoverFxPositions = async (params: {
  accounts: readonly string[];
  fromBlock: number;
  toBlock?: number;
  provider: Provider;
  pools?: readonly FxMintPoolRef[];
  chunkBlocks?: number;
  /** Max simultaneous token confirmations. See the Blue reader for why. */
  concurrency?: number;
}): Promise<FxRediscoveryReport> => {
  const concurrency = params.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `fxmint: concurrency must be a positive integer (got ${concurrency})`,
    );
  }
  const scan = await scanFxPositionTransfers(params);
  const accountSet = new Set(scan.accounts);

  type TokenResult =
    | { ok: true; position: FxRediscoveredPosition }
    | { ok: false; failure: FxUnreadablePosition };

  const confirmOne = async (
    sighting: FxPositionSighting,
  ): Promise<TokenResult> => {
    const poolContract = new Contract(
      sighting.pool,
      [...FX_POOL_ABI, 'function ownerOf(uint256) view returns (address)'],
      params.provider,
    );
    try {
      const [ownerRaw, position] = await Promise.all([
        poolContract.ownerOf(sighting.positionId, {
          blockTag: scan.toBlock,
        }) as Promise<string>,
        poolContract.getPosition(sighting.positionId, {
          blockTag: scan.toBlock,
        }) as Promise<readonly [bigint, bigint]>,
      ]);
      const currentOwner = getAddress(ownerRaw);
      const [rawColls, rawDebts] = position;
      const custodyStatus: FxPositionCustodyStatus =
        currentOwner === ZeroAddress
          ? 'burned'
          : accountSet.has(currentOwner)
          ? 'held'
          : 'elsewhere';
      return {
        ok: true,
        position: {
          protocol: 'fx',
          custody: 'bearer',
          pool: sighting.pool,
          ...(sighting.poolName === undefined
            ? {}
            : { poolName: sighting.poolName }),
          side: sighting.side,
          nftAddress: sighting.nftAddress,
          tokenSubID: sighting.tokenSubID,
          nftTokenType: sighting.nftTokenType,
          positionId: sighting.positionId,
          currentOwner,
          custodyStatus,
          rawColls,
          rawDebts,
          isEmpty: rawColls === 0n && rawDebts === 0n,
          confirmedAtBlock: scan.toBlock,
          sighting,
        },
      };
    } catch (cause: unknown) {
      // Deliberately NOT translated into "burned" or "closed". `ownerOf` does
      // revert for a nonexistent id — but this id came out of a Transfer log
      // emitted by this very contract, so a revert here means the provider is
      // answering about a different chain or a pruned block, not that the
      // position went away. Guessing either way would invent a fact.
      return {
        ok: false,
        failure: {
          pool: sighting.pool,
          positionId: sighting.positionId,
          reason: `ownerOf/getPosition(${sighting.positionId}) @ ${
            sighting.pool
          } block ${scan.toBlock}: ${errorMessage(cause)}`,
        },
      };
    }
  };

  const positions: FxRediscoveredPosition[] = [];
  const unreadable: FxUnreadablePosition[] = [];
  for (let i = 0; i < scan.sightings.length; i += concurrency) {
    const chunk = scan.sightings.slice(i, i + concurrency);
    const settled = await Promise.all(chunk.map(confirmOne));
    for (const result of settled) {
      if (result.ok) {
        positions.push(result.position);
      } else {
        unreadable.push(result.failure);
      }
    }
  }

  return {
    fromBlock: scan.fromBlock,
    toBlock: scan.toBlock,
    accounts: scan.accounts,
    pools: scan.pools,
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
 * Throwing form of {@link FxRediscoveryReport.complete}. Same contract as the
 * Blue one: use it when "found nothing" has to mean "there is nothing".
 */
export const assertFxRediscoveryComplete = (
  report: FxRediscoveryReport,
): FxRediscoveryReport => {
  if (report.complete) {
    return report;
  }
  const gaps = report.unscanned
    .map(
      range =>
        `${range.pool} ${range.fromBlock}-${range.toBlock} (${range.reason})`,
    )
    .join('; ');
  const tokens = report.unreadable
    .map(entry => `${entry.pool}#${entry.positionId} (${entry.reason})`)
    .join('; ');
  throw new Error(
    `fxmint: rediscovery over blocks ${report.fromBlock}-${report.toBlock} is incomplete — ` +
      `${report.unscannedCount} unscanned range(s) covering ${report.unscannedBlockCount} block(s)` +
      `${gaps === '' ? '' : ` [${gaps}]`}, ` +
      `${report.unreadableCount} unreadable position(s)` +
      `${tokens === '' ? '' : ` [${tokens}]`}. ` +
      `The ${report.positions.length} position(s) found are a LOWER BOUND, not an answer.`,
  );
};
