import { Contract, ZeroAddress, getAddress, type Provider } from 'ethers';
import {
  FX_ADDRESSES,
  FX_POOL_ABI,
  FX_POOL_MANAGER_ABI,
  FX_SHORT_POOL_MANAGER_ABI,
  FX_POOL_CONFIGURATION_ABI,
  FX_RATE_PROVIDER_ABI,
  FX_SMART_WALLET_CHECKER_ABI,
  FX_TOP_LEVEL_CALL_ABI,
  FX_POOL_RATIO_ABI,
  FX_PRICE_ORACLE_ABI,
  FX_SCALE_PRECISION,
  DEFAULT_FXMINT_OPERATOR,
  fxComposeScalingFactor,
  fxMinRemainingDebt,
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
// onlyTopLevelCall — the manager-level gate that can disable every fx recipe.
// =============================================================================

/**
 * Why this type exists.
 *
 * Both managers guard `operate()` with `onlyTopLevelCall`:
 *
 * ```solidity
 * modifier onlyTopLevelCall() {
 *   uint256 codesize = msg.sender.code.length;
 *   if (whitelist != address(0) && (codesize > 0 || msg.sender != tx.origin)) {
 *     if (!ISmartWalletChecker(whitelist).check(msg.sender)) revert ErrorTopLevelCall();
 *   }
 *   _;
 * }
 * ```
 *
 * **Every call this cookbook builds trips the trigger conditions.** A classic
 * relay-adapt call has code. An EIP-7702 executor has code too — the account
 * carries the 23-byte `0xef0100 || delegate` designator, and `EXTCODESIZE`
 * reports that designator, not the delegate's code — so `codesize > 0` holds
 * *unconditionally*, and self-sponsoring the transaction (which would make
 * `msg.sender == tx.origin`) does **not** evade the gate. So for fx recipes
 * `whitelist != address(0)` is equivalent to "the checker decides", and a
 * per-batch ephemeral EOA is in nobody's smart-wallet allowlist by
 * construction.
 *
 * The consequence of getting this wrong is not a mis-quote, it is total loss of
 * function — and it is **silent**. `RelayAdapt7702` executes the batch with
 * `requireSuccess = false`, so a reverting `operate()` cannot produce
 * `receipt.status === 0`: the batch mines with status 1 having done nothing,
 * and the unshielded value strands with the ephemeral executor.
 *
 * Measured on mainnet 2026-08-04, `whitelist()` reads `address(0)` on both
 * managers, so the gate is inert today.
 *
 * **How it can change.** `whitelist` is declared `address public immutable`
 * on both managers and is written only in the constructor — there is no
 * setter, so no single governance transaction can flip it. Both managers are
 * ERC-1967 proxies, so activating the gate means deploying a new
 * implementation with a non-zero `_whitelist` and upgrading the proxy. That is
 * still a governance action with no user-visible precursor, but it has two
 * useful consequences:
 *
 *  - the value is **constant between proxy upgrades**, so it is safe to cache
 *    per implementation address rather than re-read per batch;
 *  - the invalidation signal is the proxy's `Upgraded(address)` event, which an
 *    integrator monitoring f(x) can subscribe to.
 */
export type FxTopLevelCallStatus =
  /** `whitelist() == address(0)`. `operate()` accepts any caller. */
  | 'inert'
  /** Gate enforced, and `ISmartWalletChecker.check(caller)` returned true. */
  | 'allowed'
  /** Gate enforced, and `check(caller)` returned false — `operate()` reverts. */
  | 'blocked'
  /**
   * Gate enforced, but no `caller` was supplied to evaluate. This is the
   * realistic state for a 7702 flow doing a preflight *before* the ephemeral
   * executor exists. Treat it as blocked: a fresh ephemeral EOA is never
   * allowlisted.
   */
  | 'enforced-caller-unknown'
  /**
   * Gate enforced, but the `check(address)` **call** reverted or returned
   * something undecodable — the configured whitelist is not (or is no longer)
   * an `ISmartWalletChecker`. Cannot be proven safe; treat as blocked.
   *
   * Contract-level only. A transport failure (RPC down, timeout) is *not*
   * folded in here — it rejects, because "we could not reach the chain" is not
   * a verdict about the gate.
   */
  | 'enforced-checker-unreadable';

/**
 * Result of a preflight read of a manager's `onlyTopLevelCall` gate.
 *
 * This describes the **manager**, not the pool: both long pools share
 * `FX_ADDRESSES.fxPoolManager` and both shorts share
 * `FX_ADDRESSES.fxShortPoolManager`, so two pools on the same side always
 * report the same gate.
 */
export type FxTopLevelCallGate = {
  /** The manager whose gate this describes (echoed from the pool ref). */
  poolManager: Address;

  /**
   * `PoolManager.whitelist()` — the `ISmartWalletChecker` the manager
   * consults. `ZeroAddress` means the gate is inert.
   */
  whitelist: Address;

  /**
   * `whitelist !== ZeroAddress`. Because every fx call this cookbook builds
   * has code, this is equivalent to "the checker decides whether `operate()`
   * runs".
   */
  enforced: boolean;

  /** The caller the gate was evaluated against, when one was supplied. */
  caller?: Address;

  /**
   * Conservative verdict. `true` when `operate()` is known to revert with
   * `ErrorTopLevelCall()`, **and also** when the gate is enforced but this
   * preflight could not prove the caller passes. Only `'inert'` and
   * `'allowed'` produce `false`; read {@link status} for which case you are in.
   */
  blocksOperate: boolean;

  /** The named condition. See {@link FxTopLevelCallStatus}. */
  status: FxTopLevelCallStatus;

  /**
   * Present only for `'enforced-checker-unreadable'`: the failure from the
   * `check(address)` call, for logging.
   */
  checkerError?: string;
};

/**
 * Preflight the `onlyTopLevelCall` gate on the manager behind `poolRef`.
 *
 * One `eth_call` (`whitelist()`), plus a second (`check(caller)`) only when the
 * gate is enforced *and* `caller` is supplied. Read-only, and it never throws
 * for a gate that is merely enabled — a reader must not fail on a legitimate
 * on-chain state. It *does* propagate transport failures, because those are not
 * a verdict. Use {@link assertFxTopLevelCallAllowed} when you want the throwing
 * guard-clause form.
 *
 * `getFxPool` already carries this on {@link FxPool.topLevelCallGate}, so
 * callers on that path get it for free. Call this directly when you want the
 * check without paying for full pool state, or when you want to cache it (see
 * {@link FxTopLevelCallStatus} — the value is immutable per implementation).
 *
 * @param caller The account that will be `msg.sender` on `operate()`. Under
 *   EIP-7702 that is the **ephemeral executor**, not
 *   `DEFAULT_FXMINT_OPERATOR` and not the relay adapter — do not conflate it
 *   with `getFxPool`'s `operator` argument, which addresses a different
 *   (fee-table) lookup. Omit it when the executor does not exist yet; the
 *   result is then `'enforced-caller-unknown'` if the gate is on.
 */
export async function getFxTopLevelCallGate(
  poolRef: FxMintPoolRef,
  provider: Provider,
  caller?: Address,
): Promise<FxTopLevelCallGate> {
  return readFxTopLevelCallGate(
    resolvePool(poolRef).poolManager,
    provider,
    caller,
  );
}

/**
 * Did this error come from the contract, or from the wire?
 *
 * ethers v6 tags a revert / an empty return as `CALL_EXCEPTION` and an
 * undecodable one as `BAD_DATA`. Everything else it raises against a read —
 * `NETWORK_ERROR`, `SERVER_ERROR`, `TIMEOUT` — is transport, and must not be
 * mistaken for a statement about the whitelist.
 */
const isContractCallFailure = (cause: unknown): boolean => {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) {
    return false;
  }
  const { code } = cause as { code?: unknown };
  return code === 'CALL_EXCEPTION' || code === 'BAD_DATA';
};

/**
 * Manager-scoped worker behind {@link getFxTopLevelCallGate}. Kept separate so
 * `getFxPool` — which has already resolved the pool — does not resolve twice.
 */
async function readFxTopLevelCallGate(
  poolManager: Address,
  provider: Provider,
  caller?: Address,
): Promise<FxTopLevelCallGate> {
  const managerContract = new Contract(
    poolManager,
    FX_TOP_LEVEL_CALL_ABI,
    provider,
  );
  const whitelist = getAddress(
    (await managerContract.whitelist()) as string,
  ) as Address;

  const normalizedCaller =
    caller === undefined ? undefined : (getAddress(caller) as Address);

  if (whitelist === ZeroAddress) {
    return {
      poolManager,
      whitelist,
      enforced: false,
      caller: normalizedCaller,
      blocksOperate: false,
      status: 'inert',
    };
  }

  if (normalizedCaller === undefined) {
    return {
      poolManager,
      whitelist,
      enforced: true,
      caller: undefined,
      blocksOperate: true,
      status: 'enforced-caller-unknown',
    };
  }

  const checkerContract = new Contract(
    whitelist,
    FX_SMART_WALLET_CHECKER_ABI,
    provider,
  );
  try {
    const allowed = (await checkerContract.check(normalizedCaller)) as boolean;
    return {
      poolManager,
      whitelist,
      enforced: true,
      caller: normalizedCaller,
      blocksOperate: !allowed,
      status: allowed ? 'allowed' : 'blocked',
    };
  } catch (cause) {
    // Only a CONTRACT-level failure becomes a status. A transport failure is
    // rethrown: reporting "blocked" because the RPC timed out would tell the
    // integrator something false about f(x)'s configuration, and the
    // whitelist() read above already propagates transport errors — this keeps
    // the two halves of the preflight consistent.
    if (!isContractCallFailure(cause)) {
      throw cause;
    }
    // A whitelist that is not an ISmartWalletChecker cannot be proven safe.
    // Reporting it as its own status (rather than folding it into 'blocked')
    // keeps "the allowlist said no" distinguishable from "we could not ask".
    return {
      poolManager,
      whitelist,
      enforced: true,
      caller: normalizedCaller,
      blocksOperate: true,
      status: 'enforced-checker-unreadable',
      checkerError: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Throwing form of {@link getFxTopLevelCallGate}: use it as a guard before
 * building an fx batch.
 *
 * Returns the gate when `operate()` is known to be callable, and throws a
 * `fxmint:`-prefixed error naming the on-chain condition otherwise. This is the
 * whole point of the unit — without it the same failure arrives as a bare
 * `ErrorTopLevelCall()` selector inside a batch that **mined successfully**
 * (`requireSuccess = false`), which is close to undiagnosable from a receipt.
 */
export async function assertFxTopLevelCallAllowed(
  poolRef: FxMintPoolRef,
  provider: Provider,
  caller?: Address,
): Promise<FxTopLevelCallGate> {
  const gate = await getFxTopLevelCallGate(poolRef, provider, caller);
  if (!gate.blocksOperate) {
    return gate;
  }
  throw new Error(
    `fxmint: PoolManager ${gate.poolManager} enforces onlyTopLevelCall ` +
      `(whitelist ${gate.whitelist}, status "${gate.status}"${
        gate.caller === undefined ? '' : `, caller ${gate.caller}`
      }${
        gate.checkerError === undefined
          ? ''
          : `, checker error: ${gate.checkerError}`
      }) — operate() would revert with ErrorTopLevelCall(). ` +
      `Every fx call path has code, so the gate applies to the relay adapter ` +
      `and to an EIP-7702 ephemeral executor alike, and a fresh ephemeral ` +
      `account is never in an ISmartWalletChecker allowlist. Do not build ` +
      `this batch: RelayAdapt7702 runs with requireSuccess=false, so it would ` +
      `mine with status 1 having done nothing and strand the unshielded value.`,
  );
}

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

  /**
   * State of `poolManager`'s `onlyTopLevelCall` gate — **check
   * `topLevelCallGate.blocksOperate` before building any fx batch.**
   *
   * Carried here, rather than left to an opt-in call, because activating the
   * gate takes away the entire fx surface with no precursor and no error a
   * receipt can show. A preflight nobody calls is worth nothing, and every
   * integrator already calls `getFxPool` to pick up live fee ratios.
   *
   * Evaluated with **no caller**, so it reports either `'inert'` or
   * `'enforced-caller-unknown'`. `getFxPool`'s `operator` argument is *not*
   * reused as the caller: it addresses the fee table and defaults to the relay
   * adapter, whereas the `msg.sender` this gate judges is the ephemeral 7702
   * executor. To evaluate a specific account, call
   * {@link getFxTopLevelCallGate} with it directly.
   *
   * See {@link FxTopLevelCallStatus} for the full mechanism.
   */
  topLevelCallGate: FxTopLevelCallGate;
};

/**
 * Read a short pool's debt-token scaling factor from its manager, composing it
 * the same way `_getTokenScalingFactor` does.
 *
 * Two on-chain reads (one, when no rate provider is set).
 *
 * Defined on BOTH sides, but only interesting on a short. A long pool's debt is
 * fxUSD, which is not rate-bearing, so its manager holds no `tokenRates` entry
 * and this returns {@link FX_SCALE_PRECISION} — the identity, which is what
 * scaling a natively-denominated figure means. A short with no entry still
 * throws, because there the debt IS the rate-bearing asset and identity would
 * be a silent 10^10 understatement on WBTC-Short.
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
    // No `tokenRates` entry. On a LONG that is the ordinary case, not an
    // error: the debt is fxUSD, which is not rate-bearing, so the manager holds
    // no rate for it and reports debt figures already in native units —
    // `getPosition()[1]` comes back with `rawDebts === debt`. Identity is the
    // correct factor and is what the rest of the reader already assumes on that
    // side; throwing here made an exported helper unusable on half the pools it
    // ships descriptors for.
    if (resolved.side === 'long') {
      return FX_SCALE_PRECISION;
    }
    // On a SHORT the debt IS the rate-bearing asset, so a missing entry is
    // genuinely uncomputable — reading identity there would understate a
    // WBTC-Short debt by 10^10. Keep failing loudly.
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
 * Performs six sequential on-chain reads (PoolManager.getPoolInfo,
 * Pool.getTotalRawCollaterals, Pool.getLiquidateRatios,
 * Pool.getRebalanceRatios, PoolConfiguration.getPoolFeeRatio,
 * PoolManager.whitelist). Cookbook v0.1 doesn't bake in batching;
 * integrators wanting a single-roundtrip read can compose with ethers'
 * Multicall3 helper (or any external batcher) against these same function
 * selectors.
 *
 * Default operator is the Railgun relay-adapter. Pass `operator`
 * explicitly to query fees from a different operator's perspective.
 *
 * The last read populates {@link FxPool.topLevelCallGate}; see
 * {@link getFxTopLevelCallGate} to take that check on its own.
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

  // The onlyTopLevelCall gate on this pool's manager. Deliberately evaluated
  // WITHOUT a caller: `operator` above is the fee-table key (defaulting to the
  // relay adapter), not the account f(x) will see as msg.sender.
  const topLevelCallGate = await readFxTopLevelCallGate(
    resolved.poolManager,
    provider,
  );

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
    topLevelCallGate,
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

/**
 * What {@link getFxRepayCeiling} answers: how much of a position's debt f(x)
 * will actually let a collateral-preserving repay clear.
 */
export type FxRepayCeiling = {
  /** The position's debt, native units — the same figure `getFxPosition` reports. */
  debt: bigint;
  /**
   * Debt the position must RETAIN, native units. Zero only when the position
   * holds no collateral.
   */
  minRemainingDebt: bigint;
  /**
   * `debt - minRemainingDebt`. The largest repay `operate()` accepts while
   * leaving the collateral in place. Feed it to `computeFxRepay`'s
   * `minRemainingDebt`, or compare against a desired amount directly.
   */
  maxRepayAmount: bigint;
  /**
   * `maxRepayAmount / debt`, 1e18-scaled, for display. Measured at head:
   * ~0.9997e18 on `wstETH-Long`, ~0.8916e18 on `stETH-Short`.
   */
  maxRepayFraction: bigint;
};

/**
 * Read the largest debt repayment a position can take without withdrawing
 * collateral.
 *
 * f(x) refuses to leave a collateral-bearing position below `minDebtRatio`, so
 * "repay everything" is not expressible as a repay — it reverts
 * `ErrorDebtRatioTooSmall()` (`0xe91ee887`), and under a relay-adapt batch's
 * `requireSuccess = false` that revert is swallowed: the batch mines, the debt
 * is untouched, and the user is told the batch did not complete.
 *
 * Measured at head against live positions:
 *
 * | pool          | minDebtRatio | largest accepted repay |
 * |---------------|--------------|------------------------|
 * | `wstETH-Long` | 0.0001e18    | 99.97% of debt          |
 * | `stETH-Short` | 0.0909e18    | **89.16%** of debt      |
 *
 * The shorts are the reason this is worth a read rather than a rule of thumb:
 * a 99% repay is fine on a long and reverts on a short.
 *
 * To clear a debt COMPLETELY, close the position instead — a close takes both
 * legs to zero in one call, and the ratio check reads `0 < minDebtRatio × 0 ×
 * price`, which is false.
 *
 * Four reads, batched: position, ratio range, oracle address, oracle price
 * (plus the debt scaling factor on a short).
 */
export async function getFxRepayCeiling(
  positionId: bigint,
  poolRef: FxMintPoolRef,
  provider: Provider,
): Promise<FxRepayCeiling> {
  const resolved = resolvePool(poolRef);
  const poolContract = new Contract(
    resolved.address,
    FX_POOL_RATIO_ABI as unknown as string[],
    provider,
  );

  const [position, range, oracleAddress] = await Promise.all([
    getFxPosition(positionId, poolRef, provider),
    poolContract.getDebtRatioRange() as Promise<[bigint, bigint]>,
    poolContract.priceOracle() as Promise<string>,
  ]);

  const oracle = new Contract(
    oracleAddress,
    FX_PRICE_ORACLE_ABI as unknown as string[],
    provider,
  );
  // Index 1, the MIN price. `BasePool._operate` reads `(, op.price, )` and the
  // ratio check this bounds is the one inside that function — the anchor at
  // index 0 is a different number and would put the ceiling on the wrong side
  // of the boundary.
  const [, minPrice] = (await oracle.getPrice()) as [bigint, bigint, bigint];

  // The check is in RAW debt units, so compute there and scale down after.
  // Doing it the other way round is the same raw/native confusion that made
  // the close boundary wrong on the shorts.
  const rawMinRemaining = fxMinRemainingDebt({
    rawColls: position.rawColls,
    minDebtRatio: range[0],
    price: minPrice,
  });
  const minRemainingDebt =
    resolved.side === 'short'
      ? fxScaleDownRawDebt(
          rawMinRemaining,
          await getFxDebtScalingFactor(resolved, provider),
        )
      : rawMinRemaining;

  const maxRepayAmount =
    minRemainingDebt >= position.debt ? 0n : position.debt - minRemainingDebt;

  return {
    debt: position.debt,
    minRemainingDebt,
    maxRepayAmount,
    maxRepayFraction:
      position.debt === 0n
        ? 0n
        : (maxRepayAmount * FX_SCALE_PRECISION) / position.debt,
  };
}
