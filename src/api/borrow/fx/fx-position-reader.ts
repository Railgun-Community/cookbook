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
