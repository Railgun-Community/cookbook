import { AbiCoder, keccak256 } from 'ethers';

/**
 * Morpho Blue singleton (Ethereum mainnet). Immutable, admin-less; every market
 * lives in this one contract. Same value as MORPHO_ADDRESSES.blue in the vault
 * util — kept here so the Blue market side is self-contained.
 */
export const MORPHO_BLUE_ADDRESS =
  '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

/** Empty callback data — no `onMorpho*` callback path is used by these recipes. */
export const EMPTY_MORPHO_CALLBACK_DATA = '0x';

/**
 * A Morpho Blue market's immutable parameters. The market id is
 * `keccak256(abi.encode(marketParams))`.
 */
export type MarketParams = {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
};

/** Tuple form expected by the on-chain ABI (ordered). */
export const marketParamsTuple = (
  params: MarketParams,
): [string, string, string, string, bigint] => [
  params.loanToken,
  params.collateralToken,
  params.oracle,
  params.irm,
  params.lltv,
];

/**
 * Derive a market id: `keccak256(abi.encode(loanToken, collateralToken, oracle,
 * irm, lltv))`.
 */
export const getMarketId = (params: MarketParams): string => {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'address', 'address', 'uint256'],
      marketParamsTuple(params),
    ),
  );
};

// --- Morpho Blue constants (from the on-chain library) ---
export const WAD = 10n ** 18n;
export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;

/**
 * Liquidation-incentive constants, hardcoded in `Morpho.sol`. Blue exposes **no
 * getter** for either, so unlike f(x) — where `Pool.getLiquidateRatios()` is a
 * live read — the Blue liquidation incentive can only be *derived*. See
 * {@link morphoBlueLiquidationIncentiveFactor}.
 */
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = (115n * WAD) / 100n; // 1.15e18
export const LIQUIDATION_CURSOR = (3n * WAD) / 10n; // 0.3e18

// MathLib
const mulDivDown = (x: bigint, y: bigint, d: bigint): bigint => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint =>
  (x * y + (d - 1n)) / d;
const wMulDown = (x: bigint, y: bigint): bigint => mulDivDown(x, y, WAD);
const wDivDown = (x: bigint, y: bigint): bigint => mulDivDown(x, WAD, y);

/**
 * Third-order Taylor expansion of `(1 + rate)^elapsed - 1`, the exact form
 * `MathLib.wTaylorCompounded` uses on-chain. Reproducing the truncation (rather
 * than using a closed-form exponential) is what makes off-chain accrual agree
 * with the contract to the wei.
 */
const wTaylorCompounded = (rate: bigint, elapsed: bigint): bigint => {
  const firstTerm = rate * elapsed;
  const secondTerm = mulDivDown(firstTerm, firstTerm, 2n * WAD);
  const thirdTerm = mulDivDown(secondTerm, firstTerm, 3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
};

// SharesMathLib
const toAssetsUp = (
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

const toAssetsDown = (
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivDown(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

const toSharesDown = (
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivDown(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);

/**
 * Loan assets owed for a number of borrow shares, rounded up (matches Morpho's
 * repay-by-shares conversion). Used to size a conservative repay budget for a
 * shares-mode (full) close, which avoids debt growth between build and inclusion.
 */
export const borrowAssetsForShares = (
  borrowShares: bigint,
  totalBorrowAssets: bigint,
  totalBorrowShares: bigint,
): bigint => toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares);

/**
 * Loan assets redeemable for a number of supply shares, rounded **down** — the
 * mirror of {@link borrowAssetsForShares}. Debt rounds up (against the
 * borrower), a supply claim rounds down (against the lender); this is Morpho's
 * rounding policy, not a choice made here.
 *
 * There is no supply-loan-asset step in the cookbook yet, but `position()`
 * returns `supplyShares` unconditionally, so a reader that ignored them would
 * report a pure lender's account as empty.
 */
export const supplyAssetsForShares = (
  supplyShares: bigint,
  totalSupplyAssets: bigint,
  totalSupplyShares: bigint,
): bigint => toAssetsDown(supplyShares, totalSupplyAssets, totalSupplyShares);

// =============================================================================
// Interest accrual — off-chain port of Morpho.sol `_accrueInterest`.
// =============================================================================

/**
 * The six words `Morpho.market(id)` returns. Structurally identical to
 * `MorphoBlueMarketState` in the contract layer; declared here so the pure math
 * has no dependency on the contract wrapper.
 */
export type MorphoBlueMarketTotals = {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
};

export type MorphoBlueAccrual = {
  /** Totals rolled forward to `timestamp`; `lastUpdate` is set to it. */
  totals: MorphoBlueMarketTotals;
  /** Interest added to BOTH `totalBorrowAssets` and `totalSupplyAssets`. */
  interest: bigint;
  /** Fee shares minted to the fee recipient (0 when `fee == 0`). */
  feeShares: bigint;
  /** Seconds rolled forward. */
  elapsed: bigint;
};

/**
 * Roll a market's stored totals forward to `timestamp`, exactly as
 * `Morpho._accrueInterest` does before every health check.
 *
 * **Why this is not optional for a risk reader.** `market(id)` returns state as
 * of `lastUpdate`, which can be hours stale on a quiet market. Morpho accrues
 * *first* and then evaluates `_isHealthy`, so a reader that skips accrual
 * reports a debt smaller than the one the liquidator's transaction will see —
 * i.e. it under-states risk, in the one direction a risk reader must never err.
 *
 * `borrowRatePerSecond` comes from `IIrm.borrowRateView(marketParams, market)`
 * called with the *stored* (un-accrued) totals — the same inputs the contract
 * passes. Pass `0n` when `marketParams.irm == address(0)`: such a market accrues
 * nothing, which is a real state and not a failed read.
 */
export const accrueMorphoBlueInterest = (
  totals: MorphoBlueMarketTotals,
  borrowRatePerSecond: bigint,
  timestamp: bigint,
): MorphoBlueAccrual => {
  if (timestamp < totals.lastUpdate) {
    throw new Error(
      `morpho: cannot accrue backwards — timestamp ${timestamp} precedes lastUpdate ${totals.lastUpdate}`,
    );
  }
  if (borrowRatePerSecond < 0n) {
    throw new Error('morpho: borrow rate must be >= 0');
  }
  const elapsed = timestamp - totals.lastUpdate;
  if (elapsed === 0n || borrowRatePerSecond === 0n) {
    return {
      totals: { ...totals, lastUpdate: timestamp },
      interest: 0n,
      feeShares: 0n,
      elapsed,
    };
  }

  const interest = wMulDown(
    totals.totalBorrowAssets,
    wTaylorCompounded(borrowRatePerSecond, elapsed),
  );
  const totalBorrowAssets = totals.totalBorrowAssets + interest;
  const totalSupplyAssets = totals.totalSupplyAssets + interest;

  // The protocol fee is minted as supply shares against the POST-interest
  // supply assets minus the fee itself — get the order wrong and every
  // supply-share conversion drifts.
  let totalSupplyShares = totals.totalSupplyShares;
  let feeShares = 0n;
  if (totals.fee !== 0n) {
    const feeAmount = wMulDown(interest, totals.fee);
    feeShares = toSharesDown(
      feeAmount,
      totalSupplyAssets - feeAmount,
      totalSupplyShares,
    );
    totalSupplyShares += feeShares;
  }

  return {
    totals: {
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      // Borrow shares are never minted by accrual — only assets grow.
      totalBorrowShares: totals.totalBorrowShares,
      lastUpdate: timestamp,
      fee: totals.fee,
    },
    interest,
    feeShares,
    elapsed,
  };
};

// =============================================================================
// Liquidation incentive.
// =============================================================================

/**
 * Blue's liquidation incentive factor, 1e18-scaled, derived from `lltv` per
 * `Morpho.liquidate`:
 *
 * ```
 * min(MAX_LIQUIDATION_INCENTIVE_FACTOR, WAD / (WAD - LIQUIDATION_CURSOR * (WAD - lltv)))
 * ```
 *
 * `WAD` means "no bonus"; the seizure premium the liquidator keeps is
 * `factor - WAD`. The f(x) analog is `FxPool.liquidationBonusRatio`, but note
 * the two are **not the same quantity in different units**: f(x) reports a
 * 1e9-scaled *bonus* read live from the pool, Blue's is a 1e18-scaled *factor*
 * that no contract will tell you. A panel rendering both must convert.
 */
export const morphoBlueLiquidationIncentiveFactor = (lltv: bigint): bigint => {
  if (lltv < 0n || lltv > WAD) {
    throw new Error(
      `morpho: lltv must be within [0, ${WAD}] to derive a liquidation incentive (got ${lltv})`,
    );
  }
  const factor = wDivDown(WAD, WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv));
  return factor < MAX_LIQUIDATION_INCENTIVE_FACTOR
    ? factor
    : MAX_LIQUIDATION_INCENTIVE_FACTOR;
};

// =============================================================================
// Position risk math.
// =============================================================================

export type MorphoBlueRiskInputs = {
  /** Collateral held, in the collateral token's native decimals. */
  collateral: bigint;
  /** Debt in loan-token native decimals, interest-accrued and rounded up. */
  borrowAssets: bigint;
  /** `IOracle.price()`, scaled by `ORACLE_PRICE_SCALE * 10^(loanDec - collDec)`. */
  oraclePrice: bigint;
  /** Market liquidation LTV, 1e18-scaled. */
  lltv: bigint;
};

export type MorphoBlueRisk = {
  /** Collateral valued in loan-token units at `oraclePrice`, floored. */
  collateralValue: bigint;
  /** `collateralValue * lltv`, floored — the exact bound Morpho compares against. */
  maxBorrowAssets: bigint;
  /** `maxBorrowAssets - borrowAssets`, floored at 0. Collateral-limited only. */
  borrowCapacityRemaining: bigint;
  /**
   * `borrowAssets / collateralValue`, 1e18-scaled and rounded UP. The direct
   * analog of `FxPosition.debtRatio`.
   *
   * `undefined` — never `0n` — when `collateralValue == 0`, because the ratio is
   * genuinely undefined there and a zero would read as "no risk".
   */
  ltv?: bigint;
  /**
   * `maxBorrowAssets / borrowAssets`, 1e18-scaled and rounded down. `>= 1e18` is
   * healthy, `< 1e18` is liquidatable.
   *
   * `undefined` when the position carries no debt: the health factor is
   * infinite there, and 0n would invert the meaning.
   */
  healthFactor?: bigint;
  /**
   * The **exact** boundary price, in the same scale as `oraclePrice`: the
   * smallest price at which this position is still healthy. At
   * `liquidationPrice - 1` it is liquidatable, at `liquidationPrice` it is not.
   *
   * `undefined` when there is no debt, no collateral, or `lltv == 0` — cases
   * where no finite threshold exists.
   */
  liquidationPrice?: bigint;
  /**
   * Bit-exact reproduction of `!Morpho._isHealthy`: `maxBorrowAssets <
   * borrowAssets`, using the same double-floored `maxBorrowAssets` the contract
   * computes. A position sitting *exactly* at the LLTV is healthy.
   */
  isLiquidatable: boolean;
};

/**
 * Pure liquidation math for a Blue position — no I/O, no protocol reads.
 *
 * Mirrors `Morpho._isHealthy`:
 * ```
 * maxBorrow = collateral.mulDivDown(price, ORACLE_PRICE_SCALE).wMulDown(lltv)
 * borrowed  = borrowShares.toAssetsUp(totalBorrowAssets, totalBorrowShares)
 * healthy   = maxBorrow >= borrowed
 * ```
 * Both flooring steps are preserved, so `isLiquidatable` agrees with the
 * contract at the boundary rather than approximately.
 *
 * Every quantity that has no finite value is reported as `undefined`, never as
 * `0n` — see the field docs. Callers must branch on presence.
 */
export const computeMorphoBlueRisk = (
  inputs: MorphoBlueRiskInputs,
): MorphoBlueRisk => {
  const { collateral, borrowAssets, oraclePrice, lltv } = inputs;
  if (collateral < 0n || borrowAssets < 0n || oraclePrice < 0n || lltv < 0n) {
    throw new Error(
      'morpho: risk inputs (collateral, borrowAssets, oraclePrice, lltv) must be >= 0',
    );
  }

  const collateralValue = mulDivDown(collateral, oraclePrice, ORACLE_PRICE_SCALE);
  const maxBorrowAssets = wMulDown(collateralValue, lltv);
  const borrowCapacityRemaining =
    maxBorrowAssets > borrowAssets ? maxBorrowAssets - borrowAssets : 0n;
  const isLiquidatable = borrowAssets > 0n && maxBorrowAssets < borrowAssets;

  const ltv =
    collateralValue > 0n
      ? mulDivUp(borrowAssets, WAD, collateralValue)
      : undefined;
  const healthFactor =
    borrowAssets > 0n ? mulDivDown(maxBorrowAssets, WAD, borrowAssets) : undefined;
  // Invert the healthy condition for price. It has TWO floors, so it has to be
  // inverted in two steps — collapsing it into one division
  // (`borrowAssets * ORACLE_PRICE_SCALE * WAD / (collateral * lltv)`, rounded
  // up) yields a price at which the position is *already liquidatable*, because
  // that form only undoes the outer floor. Verified against a brute-force
  // boundary check: the naive form fails `isHealthy` at its own answer on every
  // non-trivial input, and is off by 2x on a dust position.
  //
  //   step 1: smallest collateralValue that supports the debt
  //           floor(cv * lltv / WAD) >= b   <=>   cv >= ceil(b * WAD / lltv)
  //   step 2: smallest price that reaches that collateralValue
  //           floor(coll * p / SCALE) >= cv <=>   p  >= ceil(cv * SCALE / coll)
  const liquidationPrice =
    borrowAssets > 0n && collateral > 0n && lltv > 0n
      ? mulDivUp(
          mulDivUp(borrowAssets, WAD, lltv),
          ORACLE_PRICE_SCALE,
          collateral,
        )
      : undefined;

  return {
    collateralValue,
    maxBorrowAssets,
    borrowCapacityRemaining,
    ltv,
    healthFactor,
    liquidationPrice,
    isLiquidatable,
  };
};

// =============================================================================
// ABI fragments for the two contracts a risk read needs beyond the singleton.
// =============================================================================

/**
 * `IOracle.price()`. Blue's oracle interface is exactly one function; the market
 * descriptor names the oracle address, so this is never hardcoded per market.
 *
 * The return is scaled by `ORACLE_PRICE_SCALE * 10^(loanDecimals -
 * collateralDecimals)`, i.e. a human price is
 * `price * 10^collateralDecimals / (1e36 * 10^loanDecimals)`.
 */
export const MORPHO_ORACLE_ABI = [
  {
    inputs: [],
    name: 'price',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const MARKET_PARAMS_COMPONENTS = [
  { internalType: 'address', name: 'loanToken', type: 'address' },
  { internalType: 'address', name: 'collateralToken', type: 'address' },
  { internalType: 'address', name: 'oracle', type: 'address' },
  { internalType: 'address', name: 'irm', type: 'address' },
  { internalType: 'uint256', name: 'lltv', type: 'uint256' },
] as const;

const MARKET_COMPONENTS = [
  { internalType: 'uint128', name: 'totalSupplyAssets', type: 'uint128' },
  { internalType: 'uint128', name: 'totalSupplyShares', type: 'uint128' },
  { internalType: 'uint128', name: 'totalBorrowAssets', type: 'uint128' },
  { internalType: 'uint128', name: 'totalBorrowShares', type: 'uint128' },
  { internalType: 'uint128', name: 'lastUpdate', type: 'uint128' },
  { internalType: 'uint128', name: 'fee', type: 'uint128' },
] as const;

/**
 * `IIrm.borrowRateView(MarketParams, Market)` — the non-mutating twin of
 * `borrowRate`, so a reader can accrue without simulating a state change.
 * Returns the per-second borrow rate, 1e18-scaled.
 */
export const MORPHO_IRM_ABI = [
  {
    inputs: [
      {
        components: MARKET_PARAMS_COMPONENTS,
        internalType: 'struct MarketParams',
        name: 'marketParams',
        type: 'tuple',
      },
      {
        components: MARKET_COMPONENTS,
        internalType: 'struct Market',
        name: 'market',
        type: 'tuple',
      },
    ],
    name: 'borrowRateView',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
