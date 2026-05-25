import { Contract, type Provider } from 'ethers';
import {
  FX_ADDRESSES,
  FX_POOL_ABI,
  FX_POOL_MANAGER_ABI,
  FX_POOL_CONFIGURATION_ABI,
  DEFAULT_FXMINT_OPERATOR,
  resolvePool,
  type Address,
  type FxMintPoolRef,
  type FxMintPoolName,
} from '../../../steps/borrow/fx/fx-mint-util';

// DEFAULT_FXMINT_OPERATOR moved to fx-mint-util.ts (alongside FX_ADDRESSES)
// as the single source of truth — package consumers continue to import it
// from `@railgun-community/cookbook` unchanged, since fx-mint-util is also
// re-exported at the package root.

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
   * Rebalance threshold in 1e18-scaled debt-ratio form. Read via
   * Pool.getRebalanceRatios()[0]. Sits BELOW the liquidation threshold:
   * when a position crosses this ratio, f(x)'s rebalancer service
   * progressively unwinds collateral to keep the position from ever
   * reaching the liquidation ratio (and getting fully seized). Wallet
   * integrators displaying position risk should treat the band
   * [rebalanceDebtRatio, liquidationDebtRatio) as a yellow zone — the
   * position is alive but the protocol is actively reducing exposure
   * on the user's behalf. Mainnet (May 2026): 0.88e18 (88%) on
   * wstETH-Long.
   */
  rebalanceDebtRatio: bigint;

  /**
   * Rebalancer bonus in 1e9-scaled form. Pool.getRebalanceRatios()[1].
   * Smaller than liquidationBonusRatio because rebalancing is the
   * less-punitive intervention. Mainnet: 2.5e7 (2.5%) on wstETH-Long.
   */
  rebalanceBonusRatio: bigint;

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
 * Reads pool-level state and per-operator fee ratios from f(x) contracts.
 *
 * Performs four sequential on-chain reads (PoolManager.getPoolInfo,
 * Pool.getTotalRawCollaterals, Pool.getLiquidateRatios,
 * Pool.getRebalanceRatios, PoolConfiguration.getPoolFeeRatio). Cookbook
 * v0.1 doesn't bake in batching; integrators wanting a single-roundtrip
 * read can compose with ethers' Multicall3 helper (or any external
 * batcher) against these same function selectors.
 *
 * Default operator is the Railgun relay-adapter. Pass `operator`
 * explicitly to query fees from a different operator's perspective.
 */
export async function getFxPool(
  poolRef: FxMintPoolRef,
  provider: Provider,
  operator: Address = DEFAULT_FXMINT_OPERATOR,
): Promise<FxPool> {
  const resolved = resolvePool(poolRef);

  const poolManagerContract = new Contract(
    FX_ADDRESSES.fxPoolManager,
    FX_POOL_MANAGER_ABI,
    provider,
  );
  const poolInfo = (await poolManagerContract.getPoolInfo(
    resolved.address,
  )) as readonly [bigint, bigint, bigint, bigint, bigint];
  // PoolManager.getPoolInfo tuple positions:
  // [collateralCapacity, collateralBalance, rawCollateral,
  //  debtCapacity, debtBalance]. Naming every slot (with _
  // for the ones we don't use here) keeps the position
  // labels glued to the right value.
  const [
    _collateralCapacity,
    collateralBalance,
    _rawCollateral,
    debtCapacity,
    debtBalance,
  ] = poolInfo;

  // Pool contract — used for the next three reads
  // (getTotalRawCollaterals, getLiquidateRatios, getRebalanceRatios).
  const poolContract = new Contract(
    resolved.address,
    FX_POOL_ABI,
    provider,
  );

  const totalRawColls = (await poolContract.getTotalRawCollaterals()) as bigint;

  // Pool.getLiquidateRatios() — added to FX_POOL_ABI in v0.1 Task 13.
  const liquidateRatios = (await poolContract.getLiquidateRatios()) as readonly [
    bigint,
    bigint,
  ];
  const [liquidationDebtRatio, liquidationBonusRatio] = liquidateRatios;

  // Pool.getRebalanceRatios() — added to FX_POOL_ABI after launch when
  // wallet integrators flagged the gap. Same tuple shape as liquidate.
  // The rebalance threshold sits below liquidation; see FxPool type doc
  // for the yellow-zone display recommendation.
  const rebalanceRatios = (await poolContract.getRebalanceRatios()) as readonly [
    bigint,
    bigint,
  ];
  const [rebalanceDebtRatio, rebalanceBonusRatio] = rebalanceRatios;

  // Per-(pool, operator) fee ratios.
  const poolConfigContract = new Contract(
    FX_ADDRESSES.fxPoolConfiguration,
    FX_POOL_CONFIGURATION_ABI,
    provider,
  );
  const fees = (await poolConfigContract.getPoolFeeRatio(
    resolved.address,
    operator,
  )) as readonly [bigint, bigint, bigint, bigint];
  // PoolConfiguration.getPoolFeeRatio tuple:
  // [supplyFeeRatio, withdrawFeeRatio, borrowFeeRatio, repayFeeRatio].
  // Only borrow + repay are non-zero on v0.1 mainnet (no supply/
  // withdraw fee on f(x)).
  const [
    _supplyFeeRatio,
    _withdrawFeeRatio,
    borrowFeeRatio,
    repayFeeRatio,
  ] = fees;

  // typeof narrowing: FxMintPoolRef = FxMintPoolName | {address;...}, so
  // the string branch is already FxMintPoolName — no cast needed.
  const name = typeof poolRef === 'string' ? poolRef : undefined;

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
    rebalanceDebtRatio,
    rebalanceBonusRatio,
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
 * Integrators wanting batched reads can compose with ethers' Multicall3
 * helper (or any external batcher) against these same function selectors.
 *
 * v0.2 may bake in a multicall variant (one roundtrip instead of four)
 * once the wallet integrator patterns settle — deferred from v0.1 to
 * keep the surface small for the upstream PR.
 */
export async function getFxPosition(
  positionId: bigint,
  poolRef: FxMintPoolRef,
  provider: Provider,
): Promise<FxPosition> {
  const resolved = resolvePool(poolRef);

  // Pool contract — three of the four reads come from it.
  const poolContract = new Contract(
    resolved.address,
    FX_POOL_ABI,
    provider,
  );

  // Pool.getPosition returns (rawColls, rawDebts).
  const positionTuple = (await poolContract.getPosition(positionId)) as readonly [
    bigint,
    bigint,
  ];
  const [rawColls, rawDebts] = positionTuple;

  // Pool.getPositionDebtRatio returns the 1e18-scaled debt ratio.
  // Note: this is a single-uint256 return per the existing FX_POOL_ABI.
  // ethers' Contract returns the raw bigint (not wrapped in a tuple) for
  // single-return-value functions.
  const debtRatio = (await poolContract.getPositionDebtRatio(
    positionId,
  )) as bigint;

  // Convert rawColls → native-decimals collateralAmount via the same
  // ratio computeFxClose uses: collateralAmount = rawColls × collateralBalance / totalRawColls.
  // Need totalRawColls + collateralBalance — fetch them; v0.1 prefers
  // clarity over a shared multicall.
  const totalRawColls = (await poolContract.getTotalRawCollaterals()) as bigint;

  const poolManagerContract = new Contract(
    FX_ADDRESSES.fxPoolManager,
    FX_POOL_MANAGER_ABI,
    provider,
  );
  const poolInfo = (await poolManagerContract.getPoolInfo(
    resolved.address,
  )) as readonly [bigint, bigint, bigint, bigint, bigint];
  // Only collateralBalance (slot 1) is used here;
  // see getFxPool above for the full tuple shape.
  const [_collateralCapacity, collateralBalance] = poolInfo;

  // collateralAmount = (rawColls × collateralBalance) / totalRawColls.
  // Guard against div-by-zero in the empty-pool case (no positions yet —
  // shouldn't happen for production pools but worth being safe).
  const collateralAmount =
    totalRawColls === 0n ? 0n : (rawColls * collateralBalance) / totalRawColls;

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
