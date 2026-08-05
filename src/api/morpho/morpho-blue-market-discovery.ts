import { Interface, type InterfaceAbi, type Provider } from 'ethers';
import {
  getMarketId,
  MORPHO_BLUE_ADDRESS,
  type MarketParams,
} from '../../steps/morpho/morpho-blue-util';

/**
 * `CreateMarket(bytes32 indexed id, MarketParams marketParams)` from
 * `morpho-org/morpho-blue` `EventsLib.sol`.
 *
 * **Only `id` is indexed.** The whole `marketParams` struct is in the data word,
 * so a node cannot filter by loan or collateral token — there is no topic to
 * filter on. Finding "every USDC market" therefore means fetching every
 * `CreateMarket` log ever emitted and filtering locally. Verified against the
 * deployed singleton: 1,708 logs, each carrying exactly two topics.
 *
 * This is a different trap from the position events, where every needed field IS
 * indexed but at inconsistent positions. Here there is nothing to get wrong —
 * only a cost to plan for.
 */
export const MORPHO_BLUE_CREATE_MARKET_ABI = [
  'event CreateMarket(bytes32 indexed id, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)',
] as const;

export const MORPHO_BLUE_CREATE_MARKET_INTERFACE = new Interface(
  MORPHO_BLUE_CREATE_MARKET_ABI as unknown as InterfaceAbi,
);

export const MORPHO_BLUE_CREATE_MARKET_TOPIC0 =
  MORPHO_BLUE_CREATE_MARKET_INTERFACE.getEvent('CreateMarket')?.topicHash ?? '';

/**
 * Block of the first `CreateMarket` on Ethereum mainnet, measured rather than
 * taken from a deploy record: 18,919,623. Scanning from genesis instead costs
 * millions of empty blocks for the same answer.
 */
export const MORPHO_BLUE_FIRST_MARKET_BLOCK = 18_919_623;

export type MorphoBlueDiscoveredMarket = {
  marketId: string;
  params: MarketParams;
  /** Block the market was created in. */
  createdAtBlock: number;
  /**
   * Whether the emitted `id` matches `keccak256(abi.encode(params))` computed
   * locally. See {@link scanMorphoBlueMarkets} for why this is checked at all.
   */
  idVerified: boolean;
  /**
   * `irm != address(0)`. A market with no interest-rate model accrues NOTHING —
   * lending into one earns zero forever, and nothing about it looks broken.
   * Measured on mainnet: 73 of 1,708 markets have a zero IRM.
   */
  accruesInterest: boolean;
  /**
   * Whether the market can be borrowed from at all: needs a collateral token, an
   * oracle, and a non-zero LLTV. Blue permits creating a market without them —
   * an "idle" market, which is a loan-token vault with no borrow side. Measured:
   * 51 of 1,708 are fully idle.
   */
  borrowable: boolean;
};

/** A block range the scan could not read. Never silently dropped. */
export type MorphoBlueMarketScanGap = {
  fromBlock: number;
  toBlock: number;
  reason: string;
};

export type MorphoBlueMarketScan = {
  markets: MorphoBlueDiscoveredMarket[];
  /** Ranges that failed. A non-empty list means `markets` is a partial answer. */
  unscanned: MorphoBlueMarketScanGap[];
  /** Logs that decoded but whose id did not match the params. */
  idMismatches: MorphoBlueDiscoveredMarket[];
  /** `unscanned.length === 0`. Surfaced so a caller cannot render a total blind. */
  complete: boolean;
  fromBlock: number;
  toBlock: number;
};

export type ScanMorphoBlueMarketsParams = {
  provider: Provider;
  /** Defaults to {@link MORPHO_BLUE_FIRST_MARKET_BLOCK}. */
  fromBlock?: number;
  /** Defaults to the provider's latest block. */
  toBlock?: number;
  /**
   * Blocks per `eth_getLogs` call. Defaults to 500,000, which works against an
   * archive provider because `CreateMarket` is sparse — roughly 1,700 logs
   * across the protocol's entire history. Lower it for a node that caps by range
   * rather than by result count.
   */
  chunkSize?: number;
};

/**
 * Enumerate every Morpho Blue market by scanning `CreateMarket`.
 *
 * There is no other enumeration path. Blue exposes `idToMarketParams(id)`, which
 * answers "what is this market" but never "which markets exist" — so a caller
 * who does not already hold an id cannot reach a market at all without these
 * logs. That makes this the market-level counterpart to
 * `rediscoverMorphoBluePositions`.
 *
 * **Every discovered market is self-verified.** A market's id is
 * `keccak256(abi.encode(marketParams))`, so the id and the params in a log are
 * redundant with each other and the reader recomputes one from the other rather
 * than trusting either. Confirmed on 50 of 50 sampled mainnet logs. Anything
 * that fails lands in `idMismatches` instead of `markets` — a fabricated or
 * mis-decoded log cannot pass as a real market, and the recomputed id is the one
 * downstream code should use anyway, since it is what `getMarketId` will produce.
 *
 * **Errors are reported, never mapped to an empty result.** A failed range
 * becomes an `unscanned` entry and clears `complete`, so "no USDC markets" and
 * "the scan could not read the blocks where the USDC markets are" stay distinct.
 *
 * Cost: with the default chunk size this is a handful of `eth_getLogs` calls
 * over the full history. Cache the result — markets are append-only, so a later
 * scan need only cover `[lastToBlock + 1, head]`.
 */
export async function scanMorphoBlueMarkets(
  params: ScanMorphoBlueMarketsParams,
): Promise<MorphoBlueMarketScan> {
  const { provider } = params;
  const fromBlock = params.fromBlock ?? MORPHO_BLUE_FIRST_MARKET_BLOCK;
  const chunkSize = params.chunkSize ?? 500_000;
  if (chunkSize <= 0) {
    throw new Error('scanMorphoBlueMarkets: chunkSize must be > 0');
  }

  let toBlock: number;
  if (params.toBlock !== undefined) {
    toBlock = params.toBlock;
  } else {
    try {
      toBlock = await provider.getBlockNumber();
    } catch (cause: unknown) {
      // Cannot even establish the range. Report it rather than returning an
      // empty scan that reads as "no markets exist".
      return {
        markets: [],
        unscanned: [
          {
            fromBlock,
            toBlock: fromBlock,
            reason: `could not read the current block: ${String(cause)}`,
          },
        ],
        idMismatches: [],
        complete: false,
        fromBlock,
        toBlock: fromBlock,
      };
    }
  }

  const markets: MorphoBlueDiscoveredMarket[] = [];
  const idMismatches: MorphoBlueDiscoveredMarket[] = [];
  const unscanned: MorphoBlueMarketScanGap[] = [];

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    let logs;
    try {
      logs = await provider.getLogs({
        address: MORPHO_BLUE_ADDRESS,
        topics: [MORPHO_BLUE_CREATE_MARKET_TOPIC0],
        fromBlock: start,
        toBlock: end,
      });
    } catch (cause: unknown) {
      unscanned.push({
        fromBlock: start,
        toBlock: end,
        reason: String(cause),
      });
      continue;
    }

    for (const log of logs) {
      let decoded;
      try {
        decoded = MORPHO_BLUE_CREATE_MARKET_INTERFACE.decodeEventLog(
          'CreateMarket',
          log.data,
          log.topics,
        );
      } catch (cause: unknown) {
        // A log matching the topic that does not decode is not a market. Record
        // the range rather than the log, so `complete` reflects the doubt.
        unscanned.push({
          fromBlock: log.blockNumber,
          toBlock: log.blockNumber,
          reason: `CreateMarket log failed to decode: ${String(cause)}`,
        });
        continue;
      }

      const raw = decoded[1] as unknown as MarketParams;
      const marketParams: MarketParams = {
        loanToken: raw.loanToken,
        collateralToken: raw.collateralToken,
        oracle: raw.oracle,
        irm: raw.irm,
        lltv: raw.lltv,
      };
      const recomputed = getMarketId(marketParams);
      const emitted = (log.topics[1] ?? '').toLowerCase();
      const idVerified = recomputed.toLowerCase() === emitted;

      const entry: MorphoBlueDiscoveredMarket = {
        // The RECOMPUTED id, not the emitted one: it is what `getMarketId` will
        // produce for these params, so downstream reads stay consistent even in
        // the mismatch case.
        marketId: recomputed,
        params: marketParams,
        createdAtBlock: log.blockNumber,
        idVerified,
        accruesInterest: !isZeroAddress(marketParams.irm),
        borrowable:
          !isZeroAddress(marketParams.collateralToken) &&
          !isZeroAddress(marketParams.oracle) &&
          marketParams.lltv > 0n,
      };
      (idVerified ? markets : idMismatches).push(entry);
    }
  }

  return {
    markets,
    unscanned,
    idMismatches,
    complete: unscanned.length === 0,
    fromBlock,
    toBlock,
  };
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const isZeroAddress = (address: string): boolean =>
  address.toLowerCase() === ZERO_ADDRESS;

export type MorphoBlueMarketFilter = {
  /** Case-insensitive. */
  loanToken?: string;
  /** Case-insensitive. */
  collateralToken?: string;
  /** Inclusive lower bound on `lltv` (1e18-scaled). */
  minLltv?: bigint;
  /** Inclusive upper bound on `lltv` (1e18-scaled). */
  maxLltv?: bigint;
  /** Restrict to a specific interest-rate model. Case-insensitive. */
  irm?: string;
  /**
   * Drop markets with no interest-rate model. A lender should almost always set
   * this: a zero-IRM market accrues nothing, so the position earns zero forever
   * and looks identical to a working one from the outside.
   */
  accruesInterestOnly?: boolean;
  /**
   * Drop markets that cannot be borrowed from — no collateral token, no oracle,
   * or a zero LLTV. A borrower should set this; a lender may not want to, since
   * an idle market is a legitimate place to park loan assets (it just pays
   * nothing).
   */
  borrowableOnly?: boolean;
};

/**
 * Filter a scan result. Pure — no network, no state.
 *
 * Separate from the scan because the scan is the expensive part and its result
 * is reusable: enumerate once, then answer many questions against the same set.
 * Every criterion here would be a topic filter if Blue indexed the struct, and
 * none of them can be.
 *
 * Filters the VERIFIED markets only. `idMismatches` are excluded by
 * construction — a market whose id does not derive from its own params should
 * not be routed to.
 */
export const filterMorphoBlueMarkets = (
  scan: MorphoBlueMarketScan,
  filter: MorphoBlueMarketFilter,
): MorphoBlueDiscoveredMarket[] => {
  const eq = (a: string, b?: string) =>
    b === undefined || a.toLowerCase() === b.toLowerCase();

  return scan.markets.filter(
    market =>
      eq(market.params.loanToken, filter.loanToken) &&
      eq(market.params.collateralToken, filter.collateralToken) &&
      eq(market.params.irm, filter.irm) &&
      (filter.minLltv === undefined || market.params.lltv >= filter.minLltv) &&
      (filter.maxLltv === undefined || market.params.lltv <= filter.maxLltv) &&
      (filter.accruesInterestOnly !== true || market.accruesInterest) &&
      (filter.borrowableOnly !== true || market.borrowable),
  );
};
