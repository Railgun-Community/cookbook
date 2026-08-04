import { NetworkName } from '@railgun-community/shared-models';
import { Contract, Provider, ZeroAddress, getAddress } from 'ethers';
import {
  MorphoBlueContract,
  MorphoBluePosition,
} from '../../contract/morpho/morpho-blue-contract';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import {
  MORPHO_IRM_ABI,
  MORPHO_ORACLE_ABI,
  MarketParams,
  MorphoBlueMarketTotals,
  WAD,
  accrueMorphoBlueInterest,
  borrowAssetsForShares,
  computeMorphoBlueRisk,
  getMarketId,
  marketParamsTuple,
  morphoBlueLiquidationIncentiveFactor,
  supplyAssetsForShares,
} from '../../steps/morpho/morpho-blue-util';
import { assertValidRecipientAddress } from '../../utils/address';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

export type MorphoSupplyCollateralQuote = {
  params: MarketParams;
  marketId: string;
  collateralToken: string;
  collateralDecimals: bigint;
  collateralAssets: bigint;
  onBehalf: string;
};

export type MorphoBorrowQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  borrowAssets: bigint;
  onBehalf: string;
  receiver: string;
};

export type MorphoRepayQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  repayAssets: bigint;
  onBehalf: string;
};

/**
 * A shares-mode repay quote (`repay(shares)`), for a clean (full or partial)
 * close that avoids debt growth between build and inclusion. The exact loan
 * pulled drifts with interest, so `maxRepaidAssets` is a conservative upper
 * bound the caller must unshield; the remainder reshields.
 */
export type MorphoRepaySharesQuote = {
  params: MarketParams;
  marketId: string;
  loanToken: string;
  loanDecimals: bigint;
  repayShares: bigint;
  expectedRepaidAssets: bigint;
  maxRepaidAssets: bigint;
  slippageBasisPoints: bigint;
  onBehalf: string;
};

export type MorphoWithdrawCollateralQuote = {
  params: MarketParams;
  marketId: string;
  collateralToken: string;
  collateralDecimals: bigint;
  withdrawAssets: bigint;
  onBehalf: string;
  receiver: string;
};

// =============================================================================
// Risk reader — market-level and position-level.
//
// Shaped to answer the same questions as the f(x) reader
// (`src/api/borrow/fx/fx-position-reader.ts`), so one risk panel can render both:
//
//   f(x)                              Morpho Blue
//   -------------------------------   ----------------------------------------
//   FxPool.liquidationDebtRatio       MorphoBlueMarket.lltv
//   FxPool.liquidationBonusRatio      MorphoBlueMarket.liquidationIncentiveFactor
//   FxPool.rebalanceDebtRatio         (no analog — see below)
//   FxPosition.debtRatio              MorphoBluePositionRisk.ltv
//   FxPosition.debt                   MorphoBluePositionRisk.borrowAssets
//   FxPosition.collateralAmount       MorphoBluePositionRisk.collateral
//
// Three deliberate divergences:
//
//   1. **No rebalance band.** f(x) runs a rebalancer that unwinds a position
//      before it can reach the liquidation ratio, so its risk display has a
//      yellow zone. Blue has nothing of the kind: crossing the LLTV makes the
//      position liquidatable by anyone, immediately, with no wallet
//      involvement. A panel must not render Blue's LLTV as if it were f(x)'s
//      rebalance threshold — for Blue it is the cliff, not the warning.
//   2. **Health factor and liquidation price are first-class.** f(x) exposes a
//      ratio and leaves the distance-to-liquidation to the caller. Because a
//      Blue holder gets no other warning, both are computed here.
//   3. **The liquidation incentive is derived, not read.** `Pool.getLiquidateRatios()`
//      is a live read on f(x); Blue hardcodes its incentive in `Morpho.sol` with
//      no getter, so it is computed from `lltv`.
//
// Read-failure policy (brief §9): no field on these types is ever set to `0n`
// because a read failed. A failed read throws, naming the read. Quantities with
// no finite value (health factor of a debt-free position, LTV with no
// collateral) are `undefined`, never `0n`. The plural reader
// (`getPositionRisks`) collects per-owner failures and reports how many, so a
// scanner can never confuse "read nothing" with "holds nothing".
// =============================================================================

/**
 * A market, addressed either by its id (`bytes32`, costs one
 * `idToMarketParams` read) or by the params themselves (id derived locally, no
 * read). Mirrors f(x)'s `FxMintPoolRef` union.
 */
export type MorphoBlueMarketRef = string | MarketParams;

export type MorphoBlueMarket = {
  marketId: string;
  params: MarketParams;

  loanToken: string;
  loanDecimals: bigint;
  collateralToken: string;
  collateralDecimals: bigint;

  /** Liquidation LTV, 1e18-scaled. f(x) analog: `FxPool.liquidationDebtRatio`. */
  lltv: bigint;
  /**
   * 1e18-scaled seizure factor (`WAD` = no bonus). Derived from `lltv`, not
   * read — Blue has no getter. f(x) analog: `FxPool.liquidationBonusRatio`,
   * which is a 1e9-scaled *bonus*; convert before comparing.
   */
  liquidationIncentiveFactor: bigint;

  oracle: string;
  /**
   * `IOracle.price()`, passed through **verbatim**.
   *
   * By convention it carries `36 + loanDecimals - collateralDecimals` decimals
   * of precision, so a human price is
   * `oraclePrice / 10 ** (36 + loanDecimals - collateralDecimals)`.
   *
   * That is a convention, not an invariant Blue enforces. Permissionless market
   * creation means an oracle can be scaled wrongly and the market still
   * functions: the mainnet PAXG/USDC 91.5% market
   * (`0x8eaf7b29…06c9`) reports a price ~1e12 above its correct scale, which
   * Morpho's own indexer flags `oracle_price_derivation: RED`. So this value is
   * NOT normalised or sanity-checked here — clamping it would be inventing a
   * number. All the risk math is scale-relative and stays self-consistent
   * either way, but a UI must not assume the derived human price is sane.
   */
  oraclePrice: bigint;

  irm: string;
  /** Per-second borrow rate, 1e18-scaled. `0n` only when `irm == address(0)`. */
  borrowRatePerSecond: bigint;

  /**
   * Market totals **rolled forward to `timestamp`** (the chain head). Prefer
   * these over {@link storedTotals}, which can be hours stale.
   *
   * Still a floor on what a liquidator sees: their transaction lands in a later
   * block and accrues further interest. Pass an explicit `timestamp` ahead of
   * head to size that in.
   *
   * Note also that the reads behind these figures are separate round trips and
   * are NOT pinned to one block — see the class docs on `getMarket`.
   */
  totals: MorphoBlueMarketTotals;
  /** Totals exactly as `market(id)` returned them, valid at `storedTotals.lastUpdate`. */
  storedTotals: MorphoBlueMarketTotals;
  /** Interest added to both asset totals by the accrual. */
  accruedInterest: bigint;
  /** Seconds between `storedTotals.lastUpdate` and `timestamp`. */
  elapsed: bigint;
  /** Block timestamp every accrued figure is computed at. */
  timestamp: bigint;

  /**
   * Loan assets available to borrow right now, market-wide. A borrow larger
   * than this reverts with `InsufficientLiquidity` regardless of collateral.
   */
  liquidityAssets: bigint;
  /**
   * `totalBorrowAssets / totalSupplyAssets`, 1e18-scaled. `0n` when the market
   * has no supply — that is Morpho's own definition of utilization on an empty
   * market, not a masked read failure.
   */
  utilization: bigint;
};

export type MorphoBluePositionRisk = {
  marketId: string;
  /** The account that holds the position — Blue's `onBehalf`. */
  owner: string;

  collateralToken: string;
  collateralDecimals: bigint;
  loanToken: string;
  loanDecimals: bigint;

  /** Raw `position(id, owner)` words. */
  collateral: bigint;
  borrowShares: bigint;
  supplyShares: bigint;

  /**
   * Debt in native loan-token units, accrued to `timestamp` and rounded up —
   * Morpho's own conversion. f(x) analog: `FxPosition.debt`.
   */
  borrowAssets: bigint;
  /** Lend-side claim in native loan units, accrued, rounded down. */
  supplyAssets: bigint;

  /** Same scale as `MorphoBlueMarket.oraclePrice`. */
  oraclePrice: bigint;
  lltv: bigint;
  liquidationIncentiveFactor: bigint;

  /** Collateral valued in loan-token units at `oraclePrice`. */
  collateralValue: bigint;
  /** The exact bound Morpho compares debt against. */
  maxBorrowAssets: bigint;
  /**
   * `maxBorrowAssets - borrowAssets`, floored at 0. **Collateral-limited only** —
   * see {@link borrowableAssets} for the liquidity-limited figure.
   */
  borrowCapacityRemaining: bigint;
  /**
   * `min(borrowCapacityRemaining, market.liquidityAssets)` — the collateral
   * bound and the market-liquidity bound together.
   *
   * Treat it as a tight upper bound rather than a guarantee. `Morpho.borrow`
   * mints shares with `toSharesUp` and `_isHealthy` converts back with
   * `toAssetsUp`, and upstream notes on `_isHealthy` that this "[r]ounds in
   * favor of the protocol, so one might not be able to borrow exactly
   * `maxBorrow` but one unit less". Fuzzing the full borrow-then-health path
   * over ~259k reachable market states found no shape where drawing exactly
   * this amount reverts, so it is not de-rated here — de-rating would make the
   * number wrong in every ordinary case. A caller that cannot tolerate a
   * revert should still back off by one unit.
   */
  borrowableAssets: bigint;

  /**
   * 1e18-scaled `borrowAssets / collateralValue`, rounded up. f(x) analog:
   * `FxPosition.debtRatio`. `undefined` (never `0n`) when there is no collateral
   * value to divide by.
   *
   * **`ltv === undefined` is not a safety signal.** It covers both "holds
   * nothing" and "holds debt with no collateral behind it", which are opposite
   * conditions — and `collateralValue` also floors to zero for dust collateral
   * at a low price. Read {@link isLiquidatable} to decide anything; do not write
   * `ltv ?? 0n` or `if (!risk.ltv)`, both of which reproduce exactly the
   * "0 means safe" misreading this field is `undefined` to avoid.
   */
  ltv?: bigint;
  /**
   * 1e18-scaled `maxBorrowAssets / borrowAssets`. `>= 1e18` healthy, `< 1e18`
   * liquidatable. `undefined` when the position carries no debt — which, unlike
   * `ltv === undefined`, does mean maximally safe.
   */
  healthFactor?: bigint;
  /**
   * The exact boundary price, in the same scale as `oraclePrice`: the position
   * is liquidatable strictly *below* this value and healthy at it.
   * `undefined` when no finite threshold exists (no debt, no collateral, or
   * `lltv == 0`).
   */
  liquidationPrice?: bigint;
  /** Bit-exact `!Morpho._isHealthy`. A position exactly at the LLTV is healthy. */
  isLiquidatable: boolean;

  /** True only when all three position words are zero. */
  isEmpty: boolean;
  /** Block timestamp every accrued figure is computed at. */
  timestamp: bigint;
};

/** One owner whose position could not be read. Never silently dropped. */
export type MorphoBluePositionReadFailure = {
  marketId: string;
  owner: string;
  reason: string;
};

export type MorphoBluePositionRiskReport = {
  market: MorphoBlueMarket;
  positions: MorphoBluePositionRisk[];
  unreadable: MorphoBluePositionReadFailure[];
  /**
   * `unreadable.length`, surfaced as its own field so a caller cannot render a
   * total without having seen it. Brief §9: never map a read error to zero.
   */
  unreadableCount: number;
};

/**
 * Wrap a single on-chain read so a failure names the read that failed instead of
 * surfacing a bare decoding error — and so it can never be mistaken for a zero.
 */
const readOrThrow = async <T>(
  label: string,
  read: () => Promise<T>,
): Promise<T> => {
  try {
    return await read();
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`morpho: read failed — ${label}: ${message}`, { cause });
  }
};

/**
 * Validate a position owner for a **read**.
 *
 * Deliberately NOT `resolveExecutorAddress`: that guard rejects the shared
 * relay-adapt contract, which is correct when routing funds but wrong here. A
 * scanner must be able to inspect any account's position, including one
 * stranded on the relay-adapt.
 */
const resolvePositionOwner = (
  owner: EphemeralExecutor | string,
  context: string,
): string => {
  const raw = typeof owner === 'string' ? owner : owner.address;
  assertValidRecipientAddress(raw, context);
  return getAddress(raw);
};

/**
 * Self-contained data layer for Morpho Blue market recipes — reads market
 * params + token decimals on-chain and validates the 7702 executor, so callers
 * pass only the market (or its id), an amount, the executor, and a provider.
 *
 * Positions are un-tokenized: `onBehalf` == `receiver` == the ephemeral EOA (also
 * `msg.sender`, always authorised for its own position). The EOA identity is the
 * only handle to the position across non-atomic batches.
 */
export class MorphoBlueAPI {
  static supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  static async getMarketParamsFromId(
    marketId: string,
    provider: Provider,
  ): Promise<MarketParams> {
    return new MorphoBlueContract(undefined, provider).idToMarketParams(
      marketId,
    );
  }

  static async getPosition(
    marketId: string,
    user: string,
    provider: Provider,
  ): Promise<MorphoBluePosition> {
    return new MorphoBlueContract(undefined, provider).position(marketId, user);
  }

  private static async decimalsOf(
    tokenAddress: string,
    provider: Provider,
  ): Promise<bigint> {
    return new ERC20Contract(tokenAddress, provider).decimals();
  }

  static async getSupplyCollateralQuote(params: {
    market: MarketParams;
    collateralAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoSupplyCollateralQuote> {
    if (params.collateralAssets <= 0n) {
      throw new Error('morpho: supply collateral assets must be > 0');
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho supply-collateral onBehalf',
    );
    const collateralDecimals = await this.decimalsOf(
      params.market.collateralToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      collateralToken: params.market.collateralToken,
      collateralDecimals,
      collateralAssets: params.collateralAssets,
      onBehalf,
    };
  }

  static async getBorrowQuote(params: {
    market: MarketParams;
    borrowAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoBorrowQuote> {
    if (params.borrowAssets <= 0n) {
      throw new Error('morpho: borrow assets must be > 0');
    }
    // onBehalf == receiver == ephemeral EOA.
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho borrow receiver',
    );
    const loanDecimals = await this.decimalsOf(
      params.market.loanToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      loanToken: params.market.loanToken,
      loanDecimals,
      borrowAssets: params.borrowAssets,
      onBehalf: executor,
      receiver: executor,
    };
  }

  static async getRepayQuote(params: {
    market: MarketParams;
    repayAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoRepayQuote> {
    if (params.repayAssets <= 0n) {
      throw new Error('morpho: repay assets must be > 0');
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho repay onBehalf',
    );
    const marketId = getMarketId(params.market);
    const blue = new MorphoBlueContract(undefined, params.provider);
    const [position, marketState, loanDecimals] = await Promise.all([
      blue.position(marketId, onBehalf),
      blue.market(marketId),
      this.decimalsOf(params.market.loanToken, params.provider),
    ]);
    // Cap the assets-denominated repay to the position's current debt. Morpho's
    // repay(assets) reverts on over-repay (borrow-share underflow); on the
    // broadcaster path that revert is swallowed (requireSuccess=false), silently
    // no-op'ing the repay while still charging fees. Debt only grows with accrual
    // between build and inclusion, so a build-time cap never over-repays; any
    // excess unshielded loan reshields via the relay-adapt balance sweep.
    const owedAssets = borrowAssetsForShares(
      position.borrowShares,
      marketState.totalBorrowAssets,
      marketState.totalBorrowShares,
    );
    if (owedAssets <= 0n) {
      throw new Error('morpho: no debt to repay');
    }
    const repayAssets =
      params.repayAssets < owedAssets ? params.repayAssets : owedAssets;
    return {
      params: params.market,
      marketId,
      loanToken: params.market.loanToken,
      loanDecimals,
      repayAssets,
      onBehalf,
    };
  }

  /**
   * Build a shares-mode repay quote for the ephemeral EOA's position. If
   * `repayShares` is omitted, the full `borrowShares` is read on-chain (full
   * close). Reads market state to size a conservative loan budget.
   */
  static async getRepaySharesQuote(params: {
    market: MarketParams;
    recipient: EphemeralExecutor | string;
    provider: Provider;
    slippageBasisPoints: bigint;
    repayShares?: bigint;
  }): Promise<MorphoRepaySharesQuote> {
    const { market, provider, slippageBasisPoints } = params;
    if (slippageBasisPoints < 1n || slippageBasisPoints > 10000n) {
      throw new Error(
        `morpho: slippageBasisPoints must be 1..10000 — a non-zero buffer is ` +
          `required to absorb interest/oracle drift (got ${slippageBasisPoints})`,
      );
    }
    const onBehalf = resolveExecutorAddress(
      params.recipient,
      'Morpho repay-shares onBehalf',
    );
    const marketId = getMarketId(market);
    const blue = new MorphoBlueContract(undefined, provider);
    const [position, marketState, loanDecimals] = await Promise.all([
      blue.position(marketId, onBehalf),
      blue.market(marketId),
      this.decimalsOf(market.loanToken, provider),
    ]);
    const repayShares = params.repayShares ?? position.borrowShares;
    if (repayShares <= 0n) {
      throw new Error('morpho: no borrow shares to repay');
    }
    if (repayShares > position.borrowShares) {
      throw new Error(
        `morpho: repayShares ${repayShares} exceeds position borrowShares ${position.borrowShares}`,
      );
    }
    const expectedRepaidAssets = borrowAssetsForShares(
      repayShares,
      marketState.totalBorrowAssets,
      marketState.totalBorrowShares,
    );
    const maxRepaidAssets =
      expectedRepaidAssets +
      (expectedRepaidAssets * slippageBasisPoints) / 10000n;
    return {
      params: market,
      marketId,
      loanToken: market.loanToken,
      loanDecimals,
      repayShares,
      expectedRepaidAssets,
      maxRepaidAssets,
      slippageBasisPoints,
      onBehalf,
    };
  }

  /**
   * Build a withdraw-collateral quote for the FULL collateral the ephemeral EOA
   * holds in the market (reads `position(id, EOA).collateral`).
   */
  static async getWithdrawAllCollateralQuote(params: {
    market: MarketParams;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoWithdrawCollateralQuote> {
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho withdraw-all receiver',
    );
    const position = await this.getPosition(
      getMarketId(params.market),
      executor,
      params.provider,
    );
    if (position.collateral <= 0n) {
      throw new Error('morpho: no collateral to withdraw');
    }
    return this.getWithdrawCollateralQuote({
      market: params.market,
      withdrawAssets: position.collateral,
      recipient: executor,
      provider: params.provider,
    });
  }

  static async getWithdrawCollateralQuote(params: {
    market: MarketParams;
    withdrawAssets: bigint;
    recipient: EphemeralExecutor | string;
    provider: Provider;
  }): Promise<MorphoWithdrawCollateralQuote> {
    if (params.withdrawAssets <= 0n) {
      throw new Error('morpho: withdraw collateral assets must be > 0');
    }
    const executor = resolveExecutorAddress(
      params.recipient,
      'Morpho withdraw-collateral receiver',
    );
    const collateralDecimals = await this.decimalsOf(
      params.market.collateralToken,
      params.provider,
    );
    return {
      params: params.market,
      marketId: getMarketId(params.market),
      collateralToken: params.market.collateralToken,
      collateralDecimals,
      withdrawAssets: params.withdrawAssets,
      onBehalf: executor,
      receiver: executor,
    };
  }

  // ===========================================================================
  // Risk reader
  // ===========================================================================

  /**
   * Resolve a {@link MorphoBlueMarketRef} to `(marketId, params)`.
   *
   * When given an id, `idToMarketParams` on an id that was never created
   * returns five zero words rather than reverting — the exact "read maps to
   * zero" trap §9 warns about, one layer up. Blue has no `marketExists`, so the
   * all-zero descriptor is the only signal and is rejected explicitly.
   */
  private static async resolveMarketRef(
    market: MorphoBlueMarketRef,
    provider: Provider,
  ): Promise<{ marketId: string; params: MarketParams }> {
    if (typeof market !== 'string') {
      return { marketId: getMarketId(market), params: market };
    }
    const params = await readOrThrow(`idToMarketParams(${market})`, () =>
      this.getMarketParamsFromId(market, provider),
    );
    if (
      params.loanToken === ZeroAddress &&
      params.collateralToken === ZeroAddress
    ) {
      throw new Error(
        `morpho: market ${market} has an all-zero descriptor — it does not exist on this chain (or the provider is on the wrong one). Not treating it as an empty market.`,
      );
    }
    return { marketId: market, params };
  }

  /**
   * Read a market's risk parameters and interest-accrued totals.
   *
   * f(x) analog: `getFxPool`. Six sequential/parallel reads —
   * `idToMarketParams` (only when addressed by id), `market`, `IOracle.price`,
   * both tokens' `decimals`, the latest block timestamp, and
   * `IIrm.borrowRateView` (skipped only when `irm == address(0)`, which is a
   * market that genuinely accrues nothing). Any failure throws naming the read.
   *
   * Pass `timestamp` to accrue to a specific second instead of the chain head —
   * required for a deterministic test, and useful for pinning the accrual to
   * the same block the state was read at.
   *
   * ## Known limitation: the reads are not pinned to one block
   *
   * Each read is its own round trip with no `blockTag`, so against a
   * load-balanced RPC pool they can be served by nodes at different heights.
   * The `timestamp`-vs-`lastUpdate` pair is guarded below (it can only lag in
   * the direction that under-states debt), but the price-vs-state pair is not:
   * a stale-high price combined with fresh debt can report a position healthy
   * that is already liquidatable. `getPositionRisks` widens this — later chunks
   * are read after the market totals they are valued against.
   *
   * Closing it properly means threading one `blockTag` through every read,
   * which needs an overrides argument on `MorphoBlueContract`'s view wrappers.
   * Until then: point this at a single node for risk decisions, or pass
   * `timestamp` and accept that the state reads are still unpinned.
   */
  static async getMarket(params: {
    market: MorphoBlueMarketRef;
    provider: Provider;
    timestamp?: bigint;
  }): Promise<MorphoBlueMarket> {
    const { provider } = params;
    const { marketId, params: marketParams } = await this.resolveMarketRef(
      params.market,
      provider,
    );

    const blue = new MorphoBlueContract(undefined, provider);
    const storedTotals = await readOrThrow(`market(${marketId})`, () =>
      blue.market(marketId),
    );
    if (storedTotals.lastUpdate === 0n) {
      throw new Error(
        `morpho: market ${marketId} has lastUpdate 0 — it has never been created. Not treating it as an empty market.`,
      );
    }

    if (marketParams.oracle === ZeroAddress) {
      throw new Error(
        `morpho: market ${marketId} has no oracle (address(0)) — collateral cannot be valued, so no health factor or liquidation price exists for it.`,
      );
    }

    const [oraclePrice, loanDecimals, collateralDecimals, timestamp] =
      await Promise.all([
        readOrThrow(`IOracle.price() @ ${marketParams.oracle}`, async () =>
          (await new Contract(
            marketParams.oracle,
            MORPHO_ORACLE_ABI,
            provider,
          ).price()) as bigint,
        ),
        readOrThrow(`decimals() @ ${marketParams.loanToken}`, () =>
          this.decimalsOf(marketParams.loanToken, provider),
        ),
        readOrThrow(`decimals() @ ${marketParams.collateralToken}`, () =>
          this.decimalsOf(marketParams.collateralToken, provider),
        ),
        params.timestamp !== undefined
          ? Promise.resolve(params.timestamp)
          : readOrThrow('getBlock("latest")', async () => {
              const block = await provider.getBlock('latest');
              if (block === null) {
                throw new Error('provider returned no latest block');
              }
              return BigInt(block.timestamp);
            }),
      ]);

    // A dead price feed is the same failure as a missing oracle, one hop out:
    // the read SUCCEEDS and returns 0, which values all collateral at nothing
    // and reports every account in the market as liquidatable. Refusing it here
    // keeps the guard above (`oracle == address(0)`) from being trivially
    // bypassable by an oracle that exists but has stopped answering.
    if (oraclePrice === 0n) {
      throw new Error(
        `morpho: oracle ${marketParams.oracle} returned price 0 — collateral cannot be valued. Not reporting every position in market ${marketId} as liquidatable.`,
      );
    }

    // `borrowRateView` takes the market as STORED — the same argument the
    // contract passes to `borrowRate` before mutating anything.
    const borrowRatePerSecond =
      marketParams.irm === ZeroAddress
        ? 0n
        : await readOrThrow(
            `IIrm.borrowRateView() @ ${marketParams.irm}`,
            async () =>
              (await new Contract(
                marketParams.irm,
                MORPHO_IRM_ABI,
                provider,
              ).borrowRateView(marketParamsTuple(marketParams), [
                storedTotals.totalSupplyAssets,
                storedTotals.totalSupplyShares,
                storedTotals.totalBorrowAssets,
                storedTotals.totalBorrowShares,
                storedTotals.lastUpdate,
                storedTotals.fee,
              ])) as bigint,
          );

    // The state read and the block read are two round trips. Against a
    // load-balanced RPC pool they can be served by nodes at different heights,
    // and if the block one lags, `timestamp < lastUpdate`. Clamping to zero
    // accrual there would silently under-state the debt — the one direction a
    // risk reader must never err — so it stays an error, with the cause named.
    if (timestamp < storedTotals.lastUpdate) {
      throw new Error(
        `morpho: market ${marketId} was read at lastUpdate ${storedTotals.lastUpdate} but the block timestamp is ${timestamp}. The provider served the two reads from nodes at different heights; retry, or pass an explicit \`timestamp\`. Not accruing zero interest, which would under-state the debt.`,
      );
    }

    const accrual = accrueMorphoBlueInterest(
      storedTotals,
      borrowRatePerSecond,
      timestamp,
    );
    const { totals } = accrual;

    const liquidityAssets =
      totals.totalSupplyAssets > totals.totalBorrowAssets
        ? totals.totalSupplyAssets - totals.totalBorrowAssets
        : 0n;
    const utilization =
      totals.totalSupplyAssets === 0n
        ? 0n
        : (totals.totalBorrowAssets * WAD) / totals.totalSupplyAssets;

    return {
      marketId,
      params: marketParams,
      loanToken: marketParams.loanToken,
      loanDecimals,
      collateralToken: marketParams.collateralToken,
      collateralDecimals,
      lltv: marketParams.lltv,
      liquidationIncentiveFactor: morphoBlueLiquidationIncentiveFactor(
        marketParams.lltv,
      ),
      oracle: marketParams.oracle,
      oraclePrice,
      irm: marketParams.irm,
      borrowRatePerSecond,
      totals,
      storedTotals,
      accruedInterest: accrual.interest,
      elapsed: accrual.elapsed,
      timestamp,
      liquidityAssets,
      utilization,
    };
  }

  /**
   * Combine an already-read market with an already-read position. Pure — no
   * network I/O — so the risk math is testable without a provider and a scanner
   * can amortise one {@link getMarket} over many positions.
   */
  static buildPositionRisk(params: {
    market: MorphoBlueMarket;
    owner: EphemeralExecutor | string;
    position: MorphoBluePosition;
  }): MorphoBluePositionRisk {
    const { market, position } = params;
    const owner = resolvePositionOwner(params.owner, 'Morpho position owner');

    const borrowAssets = borrowAssetsForShares(
      position.borrowShares,
      market.totals.totalBorrowAssets,
      market.totals.totalBorrowShares,
    );
    const supplyAssets = supplyAssetsForShares(
      position.supplyShares,
      market.totals.totalSupplyAssets,
      market.totals.totalSupplyShares,
    );

    const risk = computeMorphoBlueRisk({
      collateral: position.collateral,
      borrowAssets,
      oraclePrice: market.oraclePrice,
      lltv: market.lltv,
    });

    const borrowableAssets =
      risk.borrowCapacityRemaining < market.liquidityAssets
        ? risk.borrowCapacityRemaining
        : market.liquidityAssets;

    return {
      marketId: market.marketId,
      owner,
      collateralToken: market.collateralToken,
      collateralDecimals: market.collateralDecimals,
      loanToken: market.loanToken,
      loanDecimals: market.loanDecimals,
      collateral: position.collateral,
      borrowShares: position.borrowShares,
      supplyShares: position.supplyShares,
      borrowAssets,
      supplyAssets,
      oraclePrice: market.oraclePrice,
      lltv: market.lltv,
      liquidationIncentiveFactor: market.liquidationIncentiveFactor,
      collateralValue: risk.collateralValue,
      maxBorrowAssets: risk.maxBorrowAssets,
      borrowCapacityRemaining: risk.borrowCapacityRemaining,
      borrowableAssets,
      ltv: risk.ltv,
      healthFactor: risk.healthFactor,
      liquidationPrice: risk.liquidationPrice,
      isLiquidatable: risk.isLiquidatable,
      isEmpty:
        position.collateral === 0n &&
        position.borrowShares === 0n &&
        position.supplyShares === 0n,
      timestamp: market.timestamp,
    };
  }

  /**
   * Read one account's liquidation risk in a market.
   *
   * f(x) analog: `getFxPosition`. Unlike f(x), where the position is a bearer
   * NFT the wallet enumerates, a Blue position is keyed by the account address —
   * so the caller supplies the ephemeral executor (or any address) directly.
   *
   * Throws on any failed read. It never returns a zeroed position, because a
   * zeroed position is indistinguishable from a closed one.
   */
  static async getPositionRisk(params: {
    market: MorphoBlueMarketRef;
    owner: EphemeralExecutor | string;
    provider: Provider;
    timestamp?: bigint;
  }): Promise<MorphoBluePositionRisk> {
    const market = await this.getMarket({
      market: params.market,
      provider: params.provider,
      timestamp: params.timestamp,
    });
    const owner = resolvePositionOwner(params.owner, 'Morpho position owner');
    const position = await readOrThrow(
      `position(${market.marketId}, ${owner})`,
      () => this.getPosition(market.marketId, owner, params.provider),
    );
    return this.buildPositionRisk({ market, owner, position });
  }

  /**
   * Read many accounts' risk in one market, sharing a single market read.
   *
   * An owner whose `position()` read fails lands in `unreadable` with the
   * reason, and `unreadableCount` reports how many — so a scanner can say "3 of
   * 40 could not be read" instead of silently reporting three empty positions.
   * A failure of the shared market read still throws: with no market state,
   * nothing is computable and a partial answer would be a fiction.
   */
  static async getPositionRisks(params: {
    market: MorphoBlueMarketRef;
    owners: readonly (EphemeralExecutor | string)[];
    provider: Provider;
    timestamp?: bigint;
    /**
     * Max simultaneous `position()` reads. Bounded on purpose: firing one call
     * per owner at once gets a large scan rate-limited, and a 429 is
     * indistinguishable at this layer from any other failed read — so it would
     * land in `unreadable` and inflate the very count this method exists to
     * make trustworthy. Raise it against a private node.
     */
    concurrency?: number;
  }): Promise<MorphoBluePositionRiskReport> {
    const concurrency = params.concurrency ?? 8;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(
        `morpho: concurrency must be a positive integer (got ${concurrency})`,
      );
    }

    const market = await this.getMarket({
      market: params.market,
      provider: params.provider,
      timestamp: params.timestamp,
    });

    const positions: MorphoBluePositionRisk[] = [];
    const unreadable: MorphoBluePositionReadFailure[] = [];

    type OwnerResult =
      | { ok: true; risk: MorphoBluePositionRisk }
      | { ok: false; owner: string; error: string };

    const readOne = async (
      rawOwner: EphemeralExecutor | string,
    ): Promise<OwnerResult> => {
      // Resolve inside the per-owner boundary: a malformed address in the list
      // is that owner's failure, not the whole scan's.
      let owner: string;
      try {
        owner = resolvePositionOwner(rawOwner, 'Morpho position owner');
      } catch (cause: unknown) {
        const raw = typeof rawOwner === 'string' ? rawOwner : rawOwner.address;
        return {
          ok: false,
          owner: raw,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
      try {
        const position = await readOrThrow(
          `position(${market.marketId}, ${owner})`,
          () => this.getPosition(market.marketId, owner, params.provider),
        );
        return {
          ok: true,
          risk: this.buildPositionRisk({ market, owner, position }),
        };
      } catch (cause: unknown) {
        return {
          ok: false,
          owner,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    };

    // Chunked rather than fully parallel; input order is preserved so a caller
    // can zip the report back onto its own list.
    const settled: OwnerResult[] = [];
    for (let i = 0; i < params.owners.length; i += concurrency) {
      const chunk = params.owners.slice(i, i + concurrency);
      settled.push(...(await Promise.all(chunk.map(readOne))));
    }

    for (const result of settled) {
      if (result.ok) {
        positions.push(result.risk);
      } else {
        unreadable.push({
          marketId: market.marketId,
          owner: result.owner,
          reason: result.error,
        });
      }
    }

    return {
      market,
      positions,
      unreadable,
      unreadableCount: unreadable.length,
    };
  }
}
