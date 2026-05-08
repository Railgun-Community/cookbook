import type { Address, PublicClient } from 'viem';
import {
  FX_ADDRESSES,
  FX_POOL_ABI,
  FX_POOL_MANAGER_ABI,
  FX_POOL_CONFIGURATION_ABI,
  resolvePool,
  type FxMintPoolRef,
  type FxMintPoolName,
} from '../../../steps/borrow/fx/fx-mint-util';

// =============================================================================
// FxPool — pool-level state + per-(pool, operator) fee ratios.
// =============================================================================

export type FxPool = {
  /** Pool name when known (e.g., 'wstETH-Long'); undefined for custom pools. */
  name?: FxMintPoolName;
  /** Pool contract address (also the position-NFT contract). */
  address: Address;
  collateralToken: Address;
  collateralDecimals: bigint;

  // Per-pool capacity / state from PoolManager.getPoolInfo:
  debtCapacity: bigint;
  debtBalance: bigint;
  // Pool.getTotalRawCollaterals():
  totalRawColls: bigint;
  // PoolManager.getPoolInfo[1] — actual collateral balance in native units.
  collateralBalance: bigint;

  /**
   * Liquidation threshold in 1e18-scaled debt-ratio form. Read via
   * Pool.getLiquidateRatios()[0]. A position is liquidatable when its
   * getPositionDebtRatio() >= this value. Mainnet (May 2026): 0.95e18
   * (95%) on both wstETH-Long and WBTC-Long.
   */
  liquidationDebtRatio: bigint;

  /**
   * Liquidator bonus in 1e9-scaled form. Pool.getLiquidateRatios()[1].
   * The fraction of seized collateral the liquidator keeps as incentive.
   * Mainnet: 4e7 (4%) on both pools.
   */
  liquidationBonusRatio: bigint;

  /**
   * Per-(pool, operator) fee ratios from
   * PoolConfiguration.getPoolFeeRatio(pool, operator), 1e9-denominated.
   * Operator defaults to the Railgun relay-adapter (the canonical
   * operator for fxmint). Pass a different operator to query fees from
   * another perspective.
   * Tuple positions confirmed in Task 1 discovery:
   *   [0]=supplyFeeRatio, [1]=withdrawFeeRatio, [2]=borrowFeeRatio, [3]=repayFeeRatio
   * Only borrowFeeRatio + repayFeeRatio are non-zero for v0.1 mainnet
   * (no supply/withdraw fee on f(x)).
   */
  borrowFeeRatio: bigint;
  repayFeeRatio: bigint;
};

/**
 * Default operator for fee queries: the Railgun relay-adapter.
 * Source: railgun-fxmint-cli/src/cliConstants.ts. Hardcoded here so the
 * cookbook reader has a sensible default without depending on the CLI.
 * If Railgun rotates the relay-adapter address on a future engine
 * version, update this and the CLI's cliConstants in lockstep.
 */
export const DEFAULT_FXMINT_OPERATOR: Address =
  '0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405';

/**
 * Reads pool-level state and per-operator fee ratios from f(x) contracts.
 *
 * Performs four sequential on-chain reads (PoolManager.getPoolInfo,
 * Pool.getTotalRawCollaterals, Pool.getLiquidateRatios,
 * PoolConfiguration.getPoolFeeRatio). Cookbook v0.1 doesn't bake in
 * batching; integrators wanting a single-roundtrip read should compose
 * with viem's multicall externally.
 *
 * Default operator is the Railgun relay-adapter. Pass `operator`
 * explicitly to query fees from a different operator's perspective.
 */
export async function getFxPool(
  poolRef: FxMintPoolRef,
  provider: PublicClient,
  operator: Address = DEFAULT_FXMINT_OPERATOR,
): Promise<FxPool> {
  const resolved = resolvePool(poolRef);

  // PoolManager.getPoolInfo returns 5 fields per FX_POOL_MANAGER_ABI:
  // [collateralCapacity, collateralBalance, rawCollateral, debtCapacity, debtBalance].
  const poolInfo = await provider.readContract({
    address: FX_ADDRESSES.fxPoolManager,
    abi: FX_POOL_MANAGER_ABI,
    functionName: 'getPoolInfo',
    args: [resolved.address],
  }) as readonly [bigint, bigint, bigint, bigint, bigint];
  const [
    /* collateralCapacity */,
    collateralBalance,
    /* rawCollateral */,
    debtCapacity,
    debtBalance,
  ] = poolInfo;

  const totalRawColls = await provider.readContract({
    address: resolved.address,
    abi: FX_POOL_ABI,
    functionName: 'getTotalRawCollaterals',
    args: [],
  }) as bigint;

  // Pool.getLiquidateRatios() — added to FX_POOL_ABI in this task.
  const liquidateRatios = await provider.readContract({
    address: resolved.address,
    abi: FX_POOL_ABI,
    functionName: 'getLiquidateRatios',
    args: [],
  }) as readonly [bigint, bigint];
  const [liquidationDebtRatio, liquidationBonusRatio] = liquidateRatios;

  // Per-(pool, operator) fee ratios.
  const fees = await provider.readContract({
    address: FX_ADDRESSES.fxPoolConfiguration,
    abi: FX_POOL_CONFIGURATION_ABI,
    functionName: 'getPoolFeeRatio',
    args: [resolved.address, operator],
  }) as readonly [bigint, bigint, bigint, bigint];
  // Tuple positions confirmed in Task 1: [supply, withdraw, borrow, repay].
  const [/* supplyFeeRatio */, /* withdrawFeeRatio */, borrowFeeRatio, repayFeeRatio] = fees;

  const name = typeof poolRef === 'string' ? (poolRef as FxMintPoolName) : undefined;

  return {
    name,
    address: resolved.address,
    collateralToken: resolved.collateralToken,
    collateralDecimals: resolved.collateralDecimals,
    debtCapacity,
    debtBalance,
    totalRawColls,
    collateralBalance,
    liquidationDebtRatio,
    liquidationBonusRatio,
    borrowFeeRatio,
    repayFeeRatio,
  };
}

// =============================================================================
// FxPosition — per-position state, native-decimals collateral.
// =============================================================================

export type FxPosition = {
  positionId: bigint;
  pool: { address: Address; name?: FxMintPoolName };
  collateralToken: Address;
  collateralDecimals: bigint;

  /**
   * Native-decimals collateral amount: what 0x quotes and price feeds
   * multiply directly. WBTC: 8 decimals; wstETH: 18 decimals. Computed
   * via the same rawColls × collateralBalance / totalRawColls formula
   * computeFxClose uses internally.
   */
  collateralAmount: bigint;

  /**
   * f(x)-internal raw representation, exposed for callers that need to
   * reconstruct close-math themselves. rawColls is internal-units (scaled
   * by collateralBalance/totalRawColls); rawDebts is fxUSD wei.
   */
  rawColls: bigint;
  rawDebts: bigint;

  /**
   * Alias for rawDebts; kept under a friendlier name for wallet display
   * code that doesn't care about the rawColls/totalRawColls scaling.
   */
  debt: bigint;

  /**
   * Position's current debt ratio in f(x)'s 1e18-scaled representation
   * (1e18 = 100%, higher = closer to liquidation). Compare against
   * FxPool.liquidationDebtRatio to compute liquidation distance.
   */
  debtRatio: bigint;
};

/**
 * Reads a single position's state. Caller obtains positionId from their
 * own NFT enumeration (wallet-side, since only the wallet's keys can
 * decrypt shielded NFT ownership). All shielded fxmint positions on-chain
 * are owned-of-record by the Railgun relay-adapter, so list-by-owner is
 * not meaningful at this layer — wallets enumerate the user's shielded
 * NFTs, then call this once per id.
 *
 * Performs four sequential on-chain reads (Pool.getPosition,
 * Pool.getPositionDebtRatio, Pool.getTotalRawCollaterals,
 * PoolManager.getPoolInfo) and computes collateralAmount inline.
 * Integrators wanting batched reads should compose with viem's multicall.
 */
export async function getFxPosition(
  positionId: bigint,
  poolRef: FxMintPoolRef,
  provider: PublicClient,
): Promise<FxPosition> {
  const resolved = resolvePool(poolRef);

  // Pool.getPosition returns (rawColls, rawDebts).
  const positionTuple = await provider.readContract({
    address: resolved.address,
    abi: FX_POOL_ABI,
    functionName: 'getPosition',
    args: [positionId],
  }) as readonly [bigint, bigint];
  const [rawColls, rawDebts] = positionTuple;

  // Pool.getPositionDebtRatio returns the 1e18-scaled debt ratio.
  // Note: this is a single-uint256 return per the existing FX_POOL_ABI;
  // viem's readContract returns the raw bigint (not wrapped in a tuple).
  const debtRatio = await provider.readContract({
    address: resolved.address,
    abi: FX_POOL_ABI,
    functionName: 'getPositionDebtRatio',
    args: [positionId],
  }) as bigint;

  // Convert rawColls → native-decimals collateralAmount via the same
  // ratio computeFxClose uses: collateralAmount = rawColls × collateralBalance / totalRawColls.
  // Need totalRawColls + collateralBalance — fetch them; v0.1 prefers
  // clarity over a shared multicall.
  const totalRawColls = await provider.readContract({
    address: resolved.address,
    abi: FX_POOL_ABI,
    functionName: 'getTotalRawCollaterals',
    args: [],
  }) as bigint;

  // PoolManager.getPoolInfo returns (collateralCapacity, collateralBalance,
  // rawCollateral, debtCapacity, debtBalance) — 5 fields per the existing
  // FX_POOL_MANAGER_ABI in fx-mint-util.ts. Confirmed in Task 13.
  const poolInfo = await provider.readContract({
    address: FX_ADDRESSES.fxPoolManager,
    abi: FX_POOL_MANAGER_ABI,
    functionName: 'getPoolInfo',
    args: [resolved.address],
  }) as readonly [bigint, bigint, bigint, bigint, bigint];
  const [/* collCap */, collateralBalance] = poolInfo;

  // collateralAmount = (rawColls × collateralBalance) / totalRawColls.
  // Guard against div-by-zero in the empty-pool case (no positions yet —
  // shouldn't happen for production pools but worth being safe).
  const collateralAmount = totalRawColls === 0n
    ? 0n
    : (rawColls * collateralBalance) / totalRawColls;

  const name = typeof poolRef === 'string' ? poolRef : undefined;

  return {
    positionId,
    pool: { address: resolved.address, name },
    collateralToken: resolved.collateralToken,
    collateralDecimals: resolved.collateralDecimals,
    collateralAmount,
    rawColls,
    rawDebts,
    debt: rawDebts,
    debtRatio,
  };
}
