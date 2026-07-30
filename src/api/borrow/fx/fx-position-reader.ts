import { Contract, ZeroAddress, type Provider } from 'ethers';
import {
  FX_ADDRESSES,
  FX_POOL_ABI,
  FX_POOL_MANAGER_ABI,
  FX_SHORT_POOL_MANAGER_ABI,
  FX_POOL_CONFIGURATION_ABI,
  FX_RATE_PROVIDER_ABI,
  DEFAULT_FXMINT_OPERATOR,
  fxComposeScalingFactor,
  fxScaleDownRawDebt,
  resolvePool,
  type Address,
  type FxMintPoolRef,
  type FxMintPoolName,
  type FxPoolSide,
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

  /**
   * Collateral-side fees, 1e9-denominated. Previously discarded because both are
   * zero on long pools; **short pools put their entire fee load here** (0.3%
   * supply / 0.1% withdraw as of 2026-07-30, with borrow/repay at zero), so a
   * caller sizing a short cannot ignore them.
   *
   * `withdrawFeeRatio` is the one to thread into `FxMintCloseRecipe`.
   */
  supplyFeeRatio: bigint;
  withdrawFeeRatio: bigint;

  /** Which side of the protocol this pool is on. */
  side: FxPoolSide;
  /**
   * The token the debt is denominated in — fxUSD for a long, wstETH/WBTC for a
   * short. Surfaced so a UI does not have to re-derive it from the registry.
   */
  debtToken: Address;
  debtDecimals: bigint;
  /** Long and short pools live on different managers. */
  poolManager: Address;
};

/**
 * Read a short pool's debt-token scaling factor from its manager, composing it
 * the same way `_getTokenScalingFactor` does.
 *
 * Two on-chain reads (one, when no rate provider is set). Only meaningful for
 * short pools: on a long pool the debt is fxUSD and the manager reports debt
 * figures already in native units.
 */
export async function getFxDebtScalingFactor(
  poolRef: FxMintPoolRef,
  provider: Provider,
): Promise<bigint> {
  const resolved = resolvePool(poolRef);
  const managerContract = new Contract(
    resolved.poolManager,
    FX_SHORT_POOL_MANAGER_ABI,
    provider,
  );
  const rate = (await managerContract.tokenRates(
    resolved.debtToken,
  )) as readonly [bigint, string];
  const [scalar, rateProvider] = rate;

  if (scalar === 0n) {
    throw new Error(
      `fxmint: manager ${resolved.poolManager} has no tokenRates entry for debt token ${resolved.debtToken} — cannot scale raw debt`,
    );
  }

  if (rateProvider === ZeroAddress) {
    return fxComposeScalingFactor(scalar);
  }
  const rateProviderContract = new Contract(
    rateProvider,
    FX_RATE_PROVIDER_ABI,
    provider,
  );
  const providerRate = (await rateProviderContract.getRate()) as bigint;
  return fxComposeScalingFactor(scalar, providerRate);
}

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

  // The two managers disagree on this getter's shape, so the fragment and the
  // destructure both have to follow `side`:
  //   long : (collateralCapacity, collateralBalance, rawCollateral,
  //           debtCapacity, debtBalance)   — debt figures NATIVE
  //   short: (collateralCapacity, collateralBalance, rawDebtCapacity,
  //           rawDebtBalance)              — debt figures RAW, no rawCollateral
  // Using the long fragment against a short pool fails with an ABI buffer
  // overrun rather than returning wrong numbers, which is at least loud.
  let collateralBalance: bigint;
  let debtCapacity: bigint;
  let debtBalance: bigint;

  if (resolved.side === 'short') {
    const shortManagerContract = new Contract(
      resolved.poolManager,
      FX_SHORT_POOL_MANAGER_ABI,
      provider,
    );
    const poolInfo = (await shortManagerContract.getPoolInfo(
      resolved.address,
    )) as readonly [bigint, bigint, bigint, bigint];
    const [
      _collateralCapacity,
      shortCollateralBalance,
      rawDebtCapacity,
      rawDebtBalance,
    ] = poolInfo;

    // Convert the raw debt figures to native units so `debtCapacity` and
    // `debtBalance` mean the same thing on both sides of the API. WBTC-Short
    // raw debts are 10^10 times native.
    const scalingFactor = await getFxDebtScalingFactor(resolved, provider);
    collateralBalance = shortCollateralBalance;
    debtCapacity = fxScaleDownRawDebt(rawDebtCapacity, scalingFactor);
    debtBalance = fxScaleDownRawDebt(rawDebtBalance, scalingFactor);
  } else {
    const poolManagerContract = new Contract(
      resolved.poolManager,
      FX_POOL_MANAGER_ABI,
      provider,
    );
    const poolInfo = (await poolManagerContract.getPoolInfo(
      resolved.address,
    )) as readonly [bigint, bigint, bigint, bigint, bigint];
    // Naming every slot (with _ for the ones we don't use here) keeps the
    // position labels glued to the right value.
    const [
      _collateralCapacity,
      longCollateralBalance,
      _rawCollateral,
      longDebtCapacity,
      longDebtBalance,
    ] = poolInfo;
    collateralBalance = longCollateralBalance;
    debtCapacity = longDebtCapacity;
    debtBalance = longDebtBalance;
  }

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
  const [supplyFeeRatio, withdrawFeeRatio, borrowFeeRatio, repayFeeRatio] =
    fees;

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
    supplyFeeRatio,
    withdrawFeeRatio,
    borrowFeeRatio,
    repayFeeRatio,
    side: resolved.side,
    debtToken: resolved.debtToken,
    debtDecimals: resolved.debtDecimals,
    poolManager: resolved.poolManager,
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
   * The position's debt in **native `debtToken` units** — what to display and
   * what to pass as an `operate()` amount.
   *
   * On a long pool this equals `rawDebts` (fxUSD is unscaled). On a short pool
   * it is `rawDebts` scaled down by the manager's token scaling factor; for
   * WBTC-Short that is a factor of 10^10, so the two are **not**
   * interchangeable. Prefer this over `rawDebts` unless you are reconstructing
   * f(x)-internal math.
   */
  debt: bigint;

  /** The token `debt` is denominated in, and its native decimals. */
  debtToken: Address;
  debtDecimals: bigint;
  /** Which side of the protocol the position is on. */
  side: FxPoolSide;

  /**
   * Position's current debt ratio in f(x)'s 1e18-scaled representation
   * (1e18 = 100%, higher = closer to liquidation). Compare against
   * FxPool.liquidationDebtRatio to compute liquidation distance.
   */
  debtRatio: bigint;
};

/**
 * Reads `Pool.getNextPositionId()` — the id the pool will assign to the next
 * position it mints. Needed by `FxMintOpenRecipe`/`FxMintOpenPositionStep`,
 * which must declare the incoming position NFT in `outputNFTs` *before* the
 * batch executes so the engine's shield-back epilogue picks it up.
 *
 * ## This value is a prediction, and the prediction can be wrong
 *
 * The id is pool-global and first-come-first-served. Between this read and
 * your batch landing, anyone else opening a position on the same pool takes
 * the id, and yours shifts.
 *
 * What that costs is worth being precise about, because the failure is *not*
 * on the f(x) side. `FxMintOpenPositionStep` encodes `operate(pool, 0, ...)`
 * — literal zero, meaning "mint me a new position" — so `operate()` itself
 * is race-free and can never touch someone else's position. The mismatch
 * lands one layer later: the recipe declared id N in `outputNFTs`, f(x)
 * minted N+1, so the shield-back epilogue tries to shield an NFT the
 * executor does not hold. The batch reverts there. The position itself is
 * real and stays with the ephemeral EOA — recoverable, since that key is
 * the caller's, but not shielded.
 *
 * Practical mitigation, in order of preference:
 *   1. Read this as late as possible — ideally immediately before submitting.
 *   2. Treat a revert in the shield epilogue of an open as "id was taken,
 *      re-read and rebuild", not as a protocol error.
 *   3. On a busy pool, accept that this is a retry loop, not a guarantee.
 *
 * A structurally race-free design would read the minted id out of the
 * `operate()` return value or the ERC-721 `Transfer` event instead of
 * predicting it, but the cookbook step graph has to declare its NFT outputs
 * up front, so that is not expressible today.
 */
export async function getNextFxPositionId(
  poolRef: FxMintPoolRef,
  provider: Provider,
): Promise<bigint> {
  const resolved = resolvePool(poolRef);
  const poolContract = new Contract(resolved.address, FX_POOL_ABI, provider);
  return (await poolContract.getNextPositionId()) as bigint;
}

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

  // collateralBalance comes from slot 1 either way, but the tuple shapes
  // differ (5 words long / 4 words short), so the fragment must follow `side`.
  const isShort = resolved.side === 'short';
  const managerContract = new Contract(
    resolved.poolManager,
    isShort ? FX_SHORT_POOL_MANAGER_ABI : FX_POOL_MANAGER_ABI,
    provider,
  );
  const poolInfo = (await managerContract.getPoolInfo(
    resolved.address,
  )) as readonly bigint[];
  // Only collateralBalance (slot 1) is used here; see getFxPool above for the
  // full tuple shapes.
  const collateralBalance = poolInfo[1];

  // collateralAmount = (rawColls × collateralBalance) / totalRawColls.
  //
  // This same ratio serves both sides. On a long it undoes the collateral
  // rate-provider scaling (wstETH → stETH-denominated raw). On a short the
  // collateral is fxUSD, which the manager holds unscaled, so the ratio is
  // 1 and this is the identity — but computing it rather than special-casing
  // keeps the reader correct if f(x) ever adds a collateral rate there.
  //
  // Guard against div-by-zero in the empty-pool case (no positions yet —
  // shouldn't happen for production pools but worth being safe).
  const collateralAmount =
    totalRawColls === 0n ? 0n : (rawColls * collateralBalance) / totalRawColls;

  // The debt side is where the two diverge. A long pool's debt is fxUSD and
  // `getPosition` reports it in native wei. A short pool's debt is the volatile
  // asset and `getPosition` reports it RAW (18dp-normalised), so WBTC-Short
  // rawDebts are 10^10 times the native WBTC figure. Reporting raw as `debt`
  // would overstate a WBTC short's debt by ten orders of magnitude.
  const debt = isShort
    ? fxScaleDownRawDebt(
        rawDebts,
        await getFxDebtScalingFactor(resolved, provider),
      )
    : rawDebts;

  const name = typeof poolRef === 'string' ? poolRef : undefined;

  return {
    positionId,
    pool: { address: resolved.address, name },
    collateralToken: resolved.collateralToken,
    collateralDecimals: resolved.collateralDecimals,
    collateralAmount,
    rawColls,
    rawDebts,
    debt,
    debtToken: resolved.debtToken,
    debtDecimals: resolved.debtDecimals,
    side: resolved.side,
    debtRatio,
  };
}
