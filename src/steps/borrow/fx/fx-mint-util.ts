import { getAddress as ethersGetAddress } from 'ethers';
import { NFTTokenType } from '@railgun-community/shared-models';
import type { RecipePositionInfo } from '../../../models/export-models';

/**
 * Type alias for an EVM address. Structurally identical to viem's
 * `Address` (a `\`0x${string}\`` template-literal brand) so cookbook
 * consumers that ALSO use viem can pass these addresses straight into
 * viem's strict-typed APIs without a cast. We don't pull in viem to get
 * this — the brand is just a type-level convention. ethers itself
 * accepts any string for addresses, so this is a pure type-system aid.
 */
export type Address = `0x${string}`;

/**
 * Ethers' `getAddress` checksums and validates, then returns plain
 * `string`. We wrap it to cast the result back to the branded `Address`
 * type so call sites (FX_ADDRESSES, KNOWN_POOLS, DEFAULT_FXMINT_OPERATOR)
 * can stay tidy.
 */
const getAddress = (a: string): Address => ethersGetAddress(a) as Address;

// =============================================================================
// f(x) Protocol mainnet addresses (immutable contracts, sourced from
// @aladdindao/fx-sdk@1.0.5 dist/index.cjs and verified on Etherscan).
// =============================================================================

export const FX_ADDRESSES = {
  WETH: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  wstETH: getAddress('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'),
  fxUSD: getAddress('0x085780639CC2cACd35E474e71f4d000e2405d8f6'),
  fxPoolManager: getAddress('0x250893CA4Ba5d05626C785e8da758026928FCD24'),
  /**
   * ShortPoolManager — f(x) v2.1. Short pools are registered on a **separate**
   * manager from the long pools, so the manager cannot be a module-level
   * constant at the call site; it is carried per-pool on `ResolvedFxPool.poolManager`.
   *
   * Discovered by querying `RegisterPool(address)` across all addresses: the long
   * manager has exactly two pools registered (both Long), and the shorts appear
   * on this one. Neither the public fx-protocol-contracts repo nor
   * @aladdindao/fx-sdk@1.0.5 contains the short contracts.
   */
  fxShortPoolManager: getAddress('0xaCDc0AB51178d0Ae8F70c1EAd7d3cF5421FDd66D'),
  // Note: there is no single "position NFT" address — each pool IS its own
  // ERC-721 NFT contract (Pool inherits the ERC-721 interface). Use
  // `pool.address` from KNOWN_POOLS / resolvePool for outputNFTs.nftAddress.
  // Shared by long and short pools — verified by reading getPoolFeeRatio for
  // both short pools off this same address.
  fxPoolConfiguration: getAddress('0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d'),
} as const;

/**
 * Default operator for f(x) fee queries: the Railgun relay-adapter.
 *
 * Lives alongside FX_ADDRESSES so cookbook readers (getFxPool) and the
 * CLI's cliConstants.relayAdapter point at the same constant — preventing
 * the cookbook/CLI drift risk a separate declaration would invite.
 * Third-party wallet integrators consuming the cookbook re-export this
 * directly; the CLI imports it for its own scripts.
 *
 * If Railgun rotates the relay-adapter address on a future engine
 * version, update this once here and the CLI's cliConstants in lockstep.
 */
export const DEFAULT_FXMINT_OPERATOR: Address = getAddress(
  '0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405',
);

// =============================================================================
// ABI fragments (verbatim from @aladdindao/fx-sdk@1.0.5 dist/index.js).
// =============================================================================

export const FX_POOL_ABI = [
  // --- Core position functions ---

  // operate — lines 1291–1339 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'positionId',
        type: 'uint256',
      },
      {
        internalType: 'int256',
        name: 'newRawColl',
        type: 'int256',
      },
      {
        internalType: 'int256',
        name: 'newRawDebt',
        type: 'int256',
      },
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'operate',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
      {
        internalType: 'int256',
        name: '',
        type: 'int256',
      },
      {
        internalType: 'int256',
        name: '',
        type: 'int256',
      },
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // getPosition — lines 988–1011 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'getPosition',
    outputs: [
      {
        internalType: 'uint256',
        name: 'rawColls',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'rawDebts',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // getNextPositionId — the id `operate()` will mint when called with
  // positionId 0. Unlike the fragments around it, this one is NOT copied
  // from the fx-sdk dist (the SDK omits it); the signature was confirmed
  // by direct mainnet eth_call on both pools (2026-07-29, Alchemy
  // archive): wstETH-Long -> 1983, WBTC-Long -> 900.
  //
  // See getNextFxPositionId() in api/borrow/fx/fx-position-reader.ts for
  // the read wrapper and the race caveat that comes with predicting ids.
  {
    inputs: [],
    name: 'getNextPositionId',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // getPositionDebtRatio — lines 1012–1030 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'getPositionDebtRatio',
    outputs: [
      {
        internalType: 'uint256',
        name: 'debtRatio',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // --- ERC-721 functions (Pool IS the NFT contract) ---

  // ownerOf — lines 1340–1358 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'ownerOf',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // safeTransferFrom (without data) — lines 1583–1605 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // safeTransferFrom (with data) — lines 1606–1633 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // setApprovalForAll — lines 1634–1651 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'address',
        name: 'operator',
        type: 'address',
      },
      {
        internalType: 'bool',
        name: 'approved',
        type: 'bool',
      },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // approve (ERC-721) — lines 746–763 of dist/index.js (AFPool_default)
  {
    inputs: [
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // getTotalRawCollaterals — pool-wide raw collateral total. Used together
  // with PoolManager.getPoolInfo(pool).collateralBalance to convert a
  // position's rawColls (collateral-value units) into actual wstETH wei.
  {
    inputs: [],
    name: 'getTotalRawCollaterals',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },

  // getLiquidateRatios — returns (debtRatio, bonusRatio). debtRatio is the
  // 1e18-scaled liquidation threshold (matches getPositionDebtRatio's
  // scale); bonusRatio is the 1e9-scaled liquidator bonus. Stored on Pool
  // directly, not in PoolConfiguration. Confirmed via cast call:
  // (0.95e18, 4e7) for both wstETH-Long and WBTC-Long.
  {
    inputs: [],
    name: 'getLiquidateRatios',
    outputs: [
      { internalType: 'uint256', name: '', type: 'uint256' },
      { internalType: 'uint256', name: '', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },

  // getRebalanceRatios — returns (debtRatio, bonusRatio). Same shape as
  // getLiquidateRatios but for the REBALANCE threshold, which sits BELOW
  // the liquidation threshold. When a position's debtRatio crosses the
  // rebalance ratio, f(x)'s rebalancer service progressively unwinds
  // collateral to keep the position from ever reaching the liquidation
  // ratio (and getting fully seized with the 4% liquidator bonus). The
  // bonusRatio here is the rebalancer's smaller share (2.5% on mainnet
  // as of May 2026). Wallet integrators displaying position risk should
  // surface this as a yellow zone between healthy and liquidated.
  // Confirmed via cast call: (0.88e18, 2.5e7) for wstETH-Long.
  {
    inputs: [],
    name: 'getRebalanceRatios',
    outputs: [
      { internalType: 'uint256', name: '', type: 'uint256' },
      { internalType: 'uint256', name: '', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// PoolManager — the user-facing router. The Pool's operate function
// throws ErrorCallerNotPoolManager when called by anyone other than this
// contract, so all mint/close calls must go through PoolManager.operate(pool, ...).
// ABI extracted from @aladdindao/fx-sdk@1.0.5 PoolManager_default — the
// 4-arg overload (useStable defaults to false; mint fxUSD path).
export const FX_POOL_MANAGER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'pool', type: 'address' },
      { internalType: 'uint256', name: 'positionId', type: 'uint256' },
      { internalType: 'int256', name: 'newColl', type: 'int256' },
      { internalType: 'int256', name: 'newDebt', type: 'int256' },
    ],
    name: 'operate',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // getPoolInfo — collateral/debt capacity + balances for a pool. Used to
  // scale rawColls → actual wstETH (close.ts withdraw computation).
  {
    inputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    name: 'getPoolInfo',
    outputs: [
      { internalType: 'uint256', name: 'collateralCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'collateralBalance', type: 'uint256' },
      { internalType: 'uint256', name: 'rawCollateral', type: 'uint256' },
      { internalType: 'uint256', name: 'debtCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'debtBalance', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// PoolConfiguration — per-operator fee table. Returns (supplyFeeRatio,
// withdrawFeeRatio, borrowFeeRatio, repayFeeRatio) scaled by 1e9. close.ts
// queries this to size the fxUSD approval correctly: PoolManager.operate
// pulls `repayAmount × (1 + repayFeeRatio/1e9)` from msg.sender.
export const FX_POOL_CONFIGURATION_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'pool', type: 'address' },
      { internalType: 'address', name: 'operator', type: 'address' },
    ],
    name: 'getPoolFeeRatio',
    outputs: [
      { internalType: 'uint256', name: 'supplyFeeRatio', type: 'uint256' },
      { internalType: 'uint256', name: 'withdrawFeeRatio', type: 'uint256' },
      { internalType: 'uint256', name: 'borrowFeeRatio', type: 'uint256' },
      { internalType: 'uint256', name: 'repayFeeRatio', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * ShortPoolManager — the v2.1 manager. `operate` has the same 4-arg signature
 * (selector `0xc1c8f15b`, verified present on the deployed implementation), so
 * FX_POOL_MANAGER_ABI is reused for building calldata. This ABI exists for the
 * two getters whose shapes **differ** from the long manager.
 */
export const FX_SHORT_POOL_MANAGER_ABI = [
  // getPoolInfo — FOUR words here, not five. The long manager returns
  // (collateralCapacity, collateralBalance, rawCollateral, debtCapacity,
  // debtBalance); the short manager omits rawCollateral and reports the debt
  // side RAW. Decoding a short pool with the long fragment fails with an ABI
  // buffer overrun.
  {
    inputs: [{ internalType: 'address', name: 'pool', type: 'address' }],
    name: 'getPoolInfo',
    outputs: [
      { internalType: 'uint256', name: 'collateralCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'collateralBalance', type: 'uint256' },
      { internalType: 'uint256', name: 'rawDebtCapacity', type: 'uint256' },
      { internalType: 'uint256', name: 'rawDebtBalance', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // tokenRates — the public mapping behind the manager's internal
  // `_getTokenScalingFactor`. Needed to convert the raw debt figures above into
  // native token units.
  {
    inputs: [{ internalType: 'address', name: 'token', type: 'address' }],
    name: 'tokenRates',
    outputs: [
      { internalType: 'uint96', name: 'scalar', type: 'uint96' },
      { internalType: 'address', name: 'rateProvider', type: 'address' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * `whitelist()` — the `onlyTopLevelCall` gate on **both** managers.
 *
 * `PoolManager` and `ShortPoolManager` declare it identically
 * (`address public immutable whitelist`), so it lives in its own fragment
 * rather than being duplicated into the two side-specific ABIs —
 * FX_SHORT_POOL_MANAGER_ABI is documented as carrying only the getters whose
 * shapes *differ* from the long manager, and this one does not.
 *
 * Selector `0x93e59dc1`; asserted against the deployed managers in
 * `fx-top-level-call-gate.test.ts` rather than trusted.
 *
 * See {@link getFxTopLevelCallGate} in `src/api/borrow/fx/fx-position-reader.ts`
 * for what the value means and why it is worth reading before building a batch.
 */
export const FX_TOP_LEVEL_CALL_ABI = [
  {
    inputs: [],
    name: 'whitelist',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * `ISmartWalletChecker.check(address)` — the allowlist the managers consult
 * when `whitelist()` is non-zero.
 *
 * Verbatim from f(x)'s
 * `contracts/voting-escrow/interfaces/ISmartWalletChecker.sol`:
 * `function check(address) external view returns (bool);`
 *
 * `view`, so it is safe to `eth_call`. Selector `0xc23697a8`.
 */
export const FX_SMART_WALLET_CHECKER_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'check',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** `IRateProvider.getRate()`, used by the scaling factor when one is set. */
export const FX_RATE_PROVIDER_ABI = [
  {
    inputs: [],
    name: 'getRate',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** f(x)'s fixed-point base for scaling factors (`PRECISION` in the managers). */
export const FX_SCALE_PRECISION = 10n ** 18n;

/**
 * The pool reads behind every debt-ratio check.
 *
 * `getDebtRatioRange()` returns `(min, max)`, 1e18-scaled. The max is the
 * ceiling an OPEN must sit under (0.8666e18 on `wstETH-Long`); the min is the
 * floor a REPAY must stay above (0.0001e18 long, 0.0909e18 short — two orders
 * of magnitude apart, so a repay ceiling derived from one side is badly wrong
 * on the other).
 */
export const FX_POOL_RATIO_ABI = [
  'function getDebtRatioRange() view returns (uint256 minRatio, uint256 maxRatio)',
  'function priceOracle() view returns (address)',
] as const;

/**
 * `getPrice()` returns `(anchor, min, max)`. Which one to use is per call site
 * and the contract comments say so explicitly: `_operate` takes the **min**
 * (index 1), the rebalance path takes the max. They sit within ~0.1% of each
 * other, so picking the wrong one passes every test that is not at a boundary.
 */
export const FX_PRICE_ORACLE_ABI = [
  'function getPrice() view returns (uint256 anchorPrice, uint256 minPrice, uint256 maxPrice)',
] as const;

/**
 * `type(int256).min` — f(x)'s "take ALL of it" sentinel for either leg of
 * `operate()`. Retires the whole position leg exactly; anything else is
 * share-rounded and can miss.
 *
 * `BasePool._operate` branches on this value before doing any conversion
 * (verified against the deployed source, `contracts/core/pool/BasePool.sol`):
 *
 * ```solidity
 * } else if (newRawColl < 0) {
 *   if (newRawColl == type(int256).min) {          // max withdraw
 *     newRawColl = -int256(_convertToRawColl(op.positionColl, ..., Rounding.Down));
 *     op.newColl = -int256(op.positionColl);       // exact, no conversion
 *   } else {                                       // partial withdraw
 *     op.newColl = -int256(_convertToCollShares(uint256(-newRawColl), ..., Rounding.Up));
 *     if (uint256(-op.newColl) > op.positionColl) revert ErrorWithdrawExceedSupply();
 *   }
 * ```
 *
 * The partial branch is why naming an explicit amount cannot express a full
 * exit. A position is stored in SHARES; `getPosition()` reports raw token
 * amounts converted DOWN. Converting the reported figure back UP returns
 * `positionColl + 1` whenever the index is not the identity, which trips
 * `ErrorWithdrawExceedSupply()` (`0x1daef163`). The debt leg has the same
 * round-up (`Rounding.Up` at the partial-repay branch) and no guard at all, so
 * it underflows `op.positionDebt -= shares` and reverts `Panic(0x11)` instead.
 *
 * Measured on mainnet at head, full close against live positions:
 *
 * | pool          | explicit both legs      | sentinel both legs |
 * |---------------|-------------------------|--------------------|
 * | `wstETH-Long` | `ErrorWithdrawExceedSupply` | ok, 550,485 gas |
 * | `WBTC-Long`   | `ErrorWithdrawExceedSupply` | ok, 440,088 gas |
 * | `stETH-Short` | ok                      | ok, 569,954 gas    |
 * | `WBTC-Short`  | `Panic(0x11)`           | ok, 476,485 gas    |
 *
 * Note the shorts disagree with each other, and that `WBTC-Short` passed the
 * same test on 2026-08-12 and fails it now against the SAME position — the
 * index accrued in between. Whether an explicit amount happens to land is a
 * property of the index at mine time, not of the pool or the side, which is why
 * this is unconditional rather than gated on `side === 'long'`.
 */
export const FX_OPERATE_FULL_SENTINEL = -(2n ** 255n);

/**
 * Compose a token's scaling factor exactly as the manager's
 * `_getTokenScalingFactor` does:
 *
 * ```
 * scalar × (rateProvider == 0 ? PRECISION : rateProvider.getRate())
 * ```
 *
 * Measured on mainnet 2026-07-30:
 *
 * | manager | token  | scalar | rateProvider  | factor |
 * |---------|--------|--------|---------------|--------|
 * | short   | wstETH | 1      | none          | 1e18   |
 * | short   | WBTC   | 1e10   | none          | 1e28   |
 * | long    | wstETH | 1      | `0x81A777c4…` | dynamic |
 *
 * Note where the dynamic provider actually is: on the **long** manager's
 * collateral. The short manager's factors are static decimal normalisation
 * today (1e28 is just the 8→18 decimal shift for WBTC), but the contract path
 * supports a provider being added later, so callers must read this rather than
 * hardcode a constant.
 */
export const fxComposeScalingFactor = (
  scalar: bigint,
  rateProviderRate?: bigint,
): bigint => scalar * (rateProviderRate ?? FX_SCALE_PRECISION);

/**
 * Convert a raw (18dp-normalised) debt figure into native debt-token units,
 * mirroring the manager's `_scaleDown`: `value × PRECISION / scale`.
 *
 * For a short pool `getPosition()[1]` and `getPoolInfo()`'s debt fields are raw,
 * so this is the conversion a reader must apply before showing a debt to a user
 * or feeding it into an `operate()` amount. WBTC-Short raw debts are 10^10 times
 * the native value.
 */
export const fxScaleDownRawDebt = (
  rawDebt: bigint,
  scalingFactor: bigint,
): bigint => {
  if (scalingFactor === 0n) {
    throw new Error(
      'fxmint: token scaling factor is 0 — the manager has no tokenRates entry for this debt token',
    );
  }
  return (rawDebt * FX_SCALE_PRECISION) / scalingFactor;
};

/** Inverse of {@link fxScaleDownRawDebt} — the manager's `_scaleUp`. */
export const fxScaleUpNativeDebt = (
  nativeDebt: bigint,
  scalingFactor: bigint,
): bigint => (nativeDebt * scalingFactor) / FX_SCALE_PRECISION;

// =============================================================================
// Pool registry — 4 mainnet pools: 2 Long (v2.0) + 2 Short (v2.1).
// =============================================================================

/**
 * Which side of the protocol a pool sits on. This is not cosmetic — it selects
 * the manager, which token is collateral vs debt, and which side of the position
 * is raw-scaled:
 *
 * - **long**: deposit wstETH/WBTC, mint fxUSD debt. Collateral is the raw-scaled
 *   side (`rawColls` → native via `collateralBalance / totalRawColls`).
 * - **short**: deposit fxUSD, borrow wstETH/WBTC. **Debt** is the raw-scaled
 *   side (raw → native via the manager's `_getTokenScalingFactor`, which is
 *   rate-provider driven and therefore dynamic).
 */
export type FxPoolSide = 'long' | 'short';

export type FxMintPoolName =
  | 'wstETH-Long'
  | 'WBTC-Long'
  | 'stETH-Short'
  | 'WBTC-Short';

// FxMintPoolRef accepts either a registered pool name or a fully-specified
// custom-pool object. The custom-pool branch carries every field the amount
// accounting needs, because none of it can be derived from the address alone:
// decimals (WBTC = 8, wstETH/fxUSD = 18), the debt token, and the manager —
// which differs between long and short. For named pools these come from
// KNOWN_POOLS internally.
//
// The four v2.1 fields are **optional and default to long-pool semantics**
// (fxUSD debt at 18 decimals on the long manager), which is precisely what a
// custom pool meant before short pools existed — so callers written against the
// long-only API keep compiling and keep behaving identically. A custom *short*
// pool must set all four; omitting them resolves the long manager, and the
// short pool is not registered there, so it reverts loudly rather than
// mis-computing amounts.
export type FxMintPoolRef =
  | FxMintPoolName
  | {
      address: Address;
      collateralToken: Address;
      collateralDecimals: bigint;
      debtToken?: Address;
      debtDecimals?: bigint;
      poolManager?: Address;
      side?: FxPoolSide;
    };

/**
 * Registry-entry shape for a known f(x) pool. Exported so downstream
 * code that wants to type a "known pool" parameter (e.g., wallet UIs
 * that bind pool metadata to a typed dropdown) can do so without
 * redeclaring the shape.
 */
export type FxPoolEntry = {
  name: FxMintPoolName;
  address: Address;
  collateralToken: Address;
  // Native-units decimals for the collateral token. f(x)'s `operate()`
  // takes raw amounts in this native scale; cookbook's amount metadata
  // must match or its accounting will be off by 10^(18-decimals).
  collateralDecimals: bigint;
  /**
   * The token the position's debt is denominated in, and which `operate()`
   * pays out on borrow / pulls on repay.
   *
   * For long pools this is fxUSD — the Pool contract has no `debtToken()`
   * getter at all (it reverts), fxUSD is structural. For short pools
   * `debtToken()` exists and returns the volatile asset.
   */
  debtToken: Address;
  /** Native decimals of `debtToken`. WBTC-Short borrows 8-decimal WBTC. */
  debtDecimals: bigint;
  /** Long and short pools live on different managers. */
  poolManager: Address;
  side: FxPoolSide;
};

export const KNOWN_POOLS: readonly FxPoolEntry[] = [
  {
    name: 'wstETH-Long',
    address: getAddress('0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'),
    collateralToken: FX_ADDRESSES.wstETH,
    collateralDecimals: 18n,
    debtToken: FX_ADDRESSES.fxUSD,
    debtDecimals: 18n,
    poolManager: FX_ADDRESSES.fxPoolManager,
    side: 'long',
  },
  {
    name: 'WBTC-Long',
    address: getAddress('0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'),
    collateralToken: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    collateralDecimals: 8n,
    debtToken: FX_ADDRESSES.fxUSD,
    debtDecimals: 18n,
    poolManager: FX_ADDRESSES.fxPoolManager,
    side: 'long',
  },
  // Short pools — f(x) v2.1. Collateral and debt are swapped relative to the
  // Long pools: you supply fxUSD and borrow the volatile asset.
  // Names follow the on-chain `name()`: "f(x) stETH Short" (symbol sstETH),
  // even though the debt token is wstETH.
  {
    name: 'stETH-Short',
    address: getAddress('0x25707b9e6690b52c60ae6744d711cf9c1dfc1876'),
    collateralToken: FX_ADDRESSES.fxUSD,
    collateralDecimals: 18n,
    debtToken: FX_ADDRESSES.wstETH,
    debtDecimals: 18n,
    poolManager: FX_ADDRESSES.fxShortPoolManager,
    side: 'short',
  },
  {
    name: 'WBTC-Short',
    address: getAddress('0xa0cc8162c523998856d59065faa254f87d20a5b0'),
    collateralToken: FX_ADDRESSES.fxUSD,
    collateralDecimals: 18n,
    debtToken: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    debtDecimals: 8n,
    poolManager: FX_ADDRESSES.fxShortPoolManager,
    side: 'short',
  },
] as const;

export type ResolvedFxPool = {
  address: Address;
  collateralToken: Address;
  collateralDecimals: bigint;
  debtToken: Address;
  debtDecimals: bigint;
  poolManager: Address;
  side: FxPoolSide;
};

export function resolvePool(ref: FxMintPoolRef): ResolvedFxPool {
  if (typeof ref === 'string') {
    const found = KNOWN_POOLS.find(p => p.name === ref);
    if (!found) {
      throw new Error(
        `Unknown fxMINT pool name: ${ref}. Known pools: ${KNOWN_POOLS.map(
          p => p.name,
        ).join(', ')}`,
      );
    }
    return {
      address: found.address,
      collateralToken: found.collateralToken,
      collateralDecimals: found.collateralDecimals,
      debtToken: found.debtToken,
      debtDecimals: found.debtDecimals,
      poolManager: found.poolManager,
      side: found.side,
    };
  }
  const debtToken = getAddress(ref.debtToken ?? FX_ADDRESSES.fxUSD);
  if (ref.collateralToken.toLowerCase() === debtToken.toLowerCase()) {
    throw new Error(
      `fxmint: custom pool ${ref.address} declares the same token (${debtToken}) as both collateral and debt`,
    );
  }
  return {
    address: getAddress(ref.address),
    collateralToken: getAddress(ref.collateralToken),
    collateralDecimals: ref.collateralDecimals,
    debtToken,
    debtDecimals: ref.debtDecimals ?? 18n,
    poolManager: getAddress(ref.poolManager ?? FX_ADDRESSES.fxPoolManager),
    side: ref.side ?? 'long',
  };
}

/**
 * Locate the pool's collateral in a recipe's input balances.
 *
 * Every deposit-axis fx recipe (open, topup, topup-and-borrow) consumes the
 * pool's collateral token directly — these recipes are single-protocol and do
 * not swap. Entering from any other asset is a ComboMeal's job
 * (`src/combo-meals/fx`), which puts a 0x swap recipe upstream of the fx recipe.
 *
 * Throwing here converts a caller mistake into a clear `fxmint:` error while the
 * recipe builds its step graph, instead of a confusing low-level revert at
 * gas-estimate time. It cannot fire at construction: the input balances are not
 * known until `getRecipeOutput` supplies them.
 */
export function assertCollateralInput(
  pool: ResolvedFxPool,
  erc20Amounts: readonly { tokenAddress: string; expectedBalance: bigint }[],
): { tokenAddress: string; expectedBalance: bigint } {
  const collInput = erc20Amounts.find(
    a => a.tokenAddress.toLowerCase() === pool.collateralToken.toLowerCase(),
  );
  if (!collInput) {
    throw new Error(
      `fxmint: no ${pool.collateralToken} in input.erc20Amounts — this recipe takes the pool collateral directly; use a ComboMeal to enter from another token`,
    );
  }
  return collInput;
}

// =============================================================================
// Fee model — all four sides, one formula for long and short.
// =============================================================================

/**
 * The full fee table for a (pool, operator) pair, as returned by
 * `PoolConfiguration.getPoolFeeRatio`. All four values are 1e9-denominated
 * ({@link FEE_DENOM}).
 *
 * Long pools charge only on the debt side; short pools charge only on the
 * collateral side. Measured on mainnet 2026-07-30:
 *
 * ```
 * wstETH-Long / WBTC-Long : supply 0     withdraw 0     borrow 5e6  repay 2e6
 * stETH-Short / WBTC-Short: supply 3e6   withdraw 1e6   borrow 0    repay 0
 * ```
 *
 * Carrying all four (rather than the borrow/repay pair the long-only code used)
 * is what lets one set of formulas serve both sides: the ratios that do not
 * apply are simply zero, so no branch on `side` is needed in the amount math.
 */
export type FxFeeRatios = {
  supplyFeeRatio: bigint;
  withdrawFeeRatio: bigint;
  borrowFeeRatio: bigint;
  repayFeeRatio: bigint;
};

/**
 * Amount of collateral token the caller must part with to credit `supplied` to
 * the position.
 *
 * The supply fee is deliberately **not** applied here. `_handleSupply` in both
 * managers pulls the *full* amount from `msg.sender` and keeps the fee out of
 * what it credits to the position — so the fee shrinks the resulting position,
 * not the caller's outlay. Step accounting must declare the full amount as
 * `spent`, which is exactly what this returns.
 *
 * Present as a named function anyway, so the asymmetry is stated once and cannot
 * be "fixed" into a fee subtraction by a later reader who assumes symmetry with
 * {@link fxCollateralWithdrawOutput}.
 */
export const fxCollateralSupplySpend = (supplied: bigint): bigint => supplied;

/**
 * Collateral actually **credited to the position** when the caller supplies
 * `supplied` — the mirror of {@link fxCollateralSupplySpend}, and the reason
 * that function exists as a named identity rather than being inlined.
 *
 * The supply fee is where the caller's outlay and the position's gain part
 * company: `_handleSupply` pulls the full amount from `msg.sender` and keeps the
 * fee out of what it credits. So the ERC-20 accounting must use the gross and a
 * position record must use this. `0n` on the long pools; `3_000_000n` (0.3%) on
 * the shorts, where reporting the gross over-states the position by that much —
 * the same class of error the close step's `withdrawFeeRatio` was made required
 * to prevent.
 */
export const fxCollateralPositionCredit = (
  supplied: bigint,
  supplyFeeRatio: bigint,
): bigint => supplied - (supplied * supplyFeeRatio) / FEE_DENOM;

/** `tokenSubID` for an f(x) position NFT, as every fx step derives it. */
export const fxPositionTokenSubID = (positionId: bigint): string =>
  '0x' + positionId.toString(16);

/**
 * Build one {@link RecipePositionInfo} for an f(x) position leg.
 *
 * Centralised so the token and its decimals are always taken from the pool
 * descriptor by `kind` — pairing a debt amount with the collateral token (or
 * with `18n` on `WBTC-Short`) is exactly the mistake the descriptor exists to
 * prevent, and it is invisible in a test that only exercises a long pool.
 *
 * f(x) positions are BEARER: the handle is the position NFT, not an account.
 * `Pool` is its own ERC-721 contract, so the pool address serves as both the
 * venue id and the NFT contract.
 */
export const fxPositionInfo = (params: {
  pool: ResolvedFxPool;
  positionId: bigint;
  kind: 'collateral' | 'debt';
  direction: 'increase' | 'decrease';
  amount: bigint;
  estimateReason?: string;
}): RecipePositionInfo => {
  const { pool, positionId, kind, direction, amount, estimateReason } = params;
  const isCollateral = kind === 'collateral';
  return {
    protocol: 'fx',
    marketOrPoolId: pool.address,
    custody: 'bearer',
    nftAddress: pool.address,
    tokenSubID: fxPositionTokenSubID(positionId),
    nftTokenType: NFTTokenType.ERC721,
    kind,
    direction,
    tokenAddress: isCollateral ? pool.collateralToken : pool.debtToken,
    decimals: isCollateral ? pool.collateralDecimals : pool.debtDecimals,
    amount,
    ...(estimateReason !== undefined ? { estimateReason } : {}),
  };
};

/**
 * The collateral credit for a deposit, plus the caveat to attach when the
 * supply fee is unknown.
 *
 * `supplyFeeRatio` is optional on the deposit-axis steps because making it
 * required would break every existing caller. Omitting it is safe on a long
 * pool (the fee is zero) and over-states the position by 0.3% on a short, so
 * the shortfall is declared rather than hidden: the record carries the gross
 * amount and an `estimateReason` naming it an upper bound.
 */
export const fxCollateralCreditWithCaveat = (
  supplied: bigint,
  supplyFeeRatio: Optional<bigint>,
): { amount: bigint; estimateReason?: string } => {
  if (supplyFeeRatio === undefined) {
    return {
      amount: supplied,
      estimateReason:
        'upper bound: supplyFeeRatio was not supplied, so the f(x) supply fee ' +
        'is not deducted. Exact on the long pools (fee 0); over-states a short ' +
        "pool's credited collateral by the fee (0.3% today). Read it from " +
        'getFxPool(...).supplyFeeRatio.',
    };
  }
  return { amount: fxCollateralPositionCredit(supplied, supplyFeeRatio) };
};

/**
 * Collateral actually received when withdrawing `withdrawn` from a position.
 *
 * Unlike supply, the withdraw fee **does** come out of the caller's proceeds:
 * `_handleWithdraw` transfers `newColl - fee`. Declaring the gross amount as an
 * output would over-state the reshielded balance and fail the recipe's amount
 * accounting.
 */
export const fxCollateralWithdrawOutput = (
  withdrawn: bigint,
  withdrawFeeRatio: bigint,
): bigint => withdrawn - (withdrawn * withdrawFeeRatio) / FEE_DENOM;

/**
 * Debt token actually received when borrowing `borrowed`.
 * `_handleBorrow` transfers `debtAmount - fee`.
 *
 * For a long pool this is the fxUSD minted; for a short pool it is the volatile
 * asset borrowed from the counterparty long pool.
 */
export const fxDebtBorrowOutput = (
  borrowed: bigint,
  borrowFeeRatio: bigint,
): bigint => borrowed - (borrowed * borrowFeeRatio) / FEE_DENOM;

/**
 * Debt token the caller must part with (and approve) to repay `repaid`.
 *
 * `_handleRepay` pulls the fee and the principal in two separate
 * `transferFrom` calls, so the total is `repaid × (1 + fee)` — the fee is
 * charged *on top of*, not deducted from, the principal. Approvals sized to the
 * principal alone revert.
 */
export const fxDebtRepaySpend = (
  repaid: bigint,
  repayFeeRatio: bigint,
): bigint => repaid + (repaid * repayFeeRatio) / FEE_DENOM;

// =============================================================================
// Close-side amount math.
// =============================================================================

export const FEE_DENOM = 1_000_000_000n;
export const BPS_DENOM = 10_000n;

/**
 * Everything `computeFxClose` needs, in **native token units on both axes**.
 *
 * The previous shape took `rawColls` / `rawDebts` / `collateralBalance` /
 * `totalRawColls` — four f(x)-internal values — and re-derived native collateral
 * from three of them. That was wrong in a way no long-pool test could see:
 * longs report debt native and collateral raw, shorts report debt **raw** and
 * collateral native, so on `WBTC-Short` a caller passing `rawDebts` (10^10× the
 * native figure) got a `withdrawColl` 10^10 too small, a `repayAmount` that the
 * debt ceiling never capped, and `partialClose` stuck at `true`.
 *
 * `getFxPosition` already does both conversions once, at the reader boundary.
 * This type now takes those two results directly, so the raw/native distinction
 * is not expressible here at all.
 */
export type FxCloseInputs = {
  /**
   * Position collateral in **native `collateralToken` units** —
   * `getFxPosition().collateralAmount`. Not `rawColls`.
   */
  collateral: bigint;
  /**
   * Position debt in **native `debtToken` units** — `getFxPosition().debt`.
   * Not `rawDebts`: on the short pools the two differ by the manager's token
   * scaling factor (10^10 on `WBTC-Short`).
   */
  debt: bigint;
  /**
   * Caller's available shielded balance **of the pool's debt token** — the
   * token a close repays. fxUSD on a long; wstETH/WBTC on a short, where fxUSD
   * is the *collateral* and passing it here would be the wrong token entirely.
   */
  availableDebtToken: bigint;
  /** `PoolConfiguration.getPoolFeeRatio(pool, operator)[3]`, 1e9-denominated. */
  repayFeeRatio: bigint;
  /**
   * `PoolConfiguration.getPoolFeeRatio(pool, operator)[1]`, 1e9-denominated —
   * `getFxPool(...).withdrawFeeRatio`. Required, not optional: it is `0n` on the
   * long pools and `1_000_000n` (0.1%) on the shorts, and defaulting it to zero
   * silently over-declares a short's reshielded collateral.
   */
  withdrawFeeRatio: bigint;
  /** Railgun's unshield fee in basis points (25 on mainnet). */
  railgunUnshieldFeeBps: bigint;
};

export type FxCloseAmounts = {
  debtTokenAfterUnshield: bigint;
  maxRepayUnderFee: bigint;
  repayAmount: bigint;
  approveAmount: bigint;
  /**
   * **GROSS** collateral withdrawal — the magnitude encoded into `operate()`.
   * f(x)'s `_handleWithdraw` transfers this *minus* the withdraw fee, so it is
   * not what the caller receives. Use {@link FxCloseAmounts.withdrawCollNet}
   * for anything user-facing or for sizing an external swap.
   */
  withdrawColl: bigint;
  /**
   * Collateral the caller actually receives: `withdrawColl` net of the withdraw
   * fee. This is the figure a downstream 0x leg must sell — quoting the gross
   * amount sells more than the executor holds, and since relay-adapt runs with
   * `requireSuccess = false` that reverts the swap while the batch still mines,
   * stranding the collateral at the executor.
   */
  withdrawCollNet: bigint;
  /** Echoed from the input so `...amounts` still satisfies the recipe options. */
  withdrawFeeRatio: bigint;
  partialClose: boolean;
};

export function computeFxClose(input: FxCloseInputs): FxCloseAmounts {
  const { collateral, debt, withdrawFeeRatio } = input;

  assertNativeDebt(debt, 'computeFxClose');
  if (debt === 0n) {
    throw new Error(
      'fxmint: computeFxClose — position debt is 0; there is nothing to repay, ' +
        'so the proportional withdraw is undefined. A collateral-only withdrawal ' +
        'is an adjust, not a close.',
    );
  }

  // Repay-side math: factored out so FxMintRepayDebtRecipe shares it.
  // For close, the user's "desired repay amount" is the entire debt — they
  // want to close as much as they can given debt-token availability + fees.
  const repay = computeFxRepay({
    debt,
    availableDebtToken: input.availableDebtToken,
    desiredRepayAmount: debt,
    repayFeeRatio: input.repayFeeRatio,
    railgunUnshieldFeeBps: input.railgunUnshieldFeeBps,
  });

  // Collateral-side math: proportional withdraw at the repaid fraction. Both
  // terms of the ratio are native, so the fraction is dimensionless — that is
  // the property the old raw-denominator version silently violated.
  const withdrawColl = (collateral * repay.repayAmount) / debt;

  // The gross/net split is real, not redundancy: `withdrawColl` is the operate()
  // argument and `withdrawCollNet` is the receivable. They differ by 0.1% on the
  // shorts and are identical on the longs.
  const withdrawCollNet = fxCollateralWithdrawOutput(
    withdrawColl,
    withdrawFeeRatio,
  );
  const partialClose = repay.repayAmount < debt;

  // FxRepayAmounts is a strict subset of FxCloseAmounts's repay-side
  // fields (debtTokenAfterUnshield, maxRepayUnderFee, repayAmount,
  // approveAmount), so spreading is type-safe and avoids the verbose
  // per-field re-listing this used to do.
  return {
    ...repay,
    withdrawColl,
    withdrawCollNet,
    withdrawFeeRatio,
    partialClose,
  };
}

// =============================================================================
// Repay-side amount math, factored out so FxMintRepayDebtRecipe (which has
// no collateral side) can reuse the same fee accounting that computeFxClose
// uses for its repay leg. computeFxClose above delegates to this.
// =============================================================================

export type FxRepayInputs = {
  /**
   * Position's current debt in **native `debtToken` units** —
   * `getFxPosition().debt`, never `.rawDebts`. On the short pools the raw figure
   * is 10^10× larger, which makes the debt ceiling at the bottom of this
   * function stop binding and lets `repayAmount` exceed the debt that exists.
   */
  debt: bigint;
  // Caller's available shielded balance of the pool's DEBT token; the recipe
  // input balance. fxUSD on a long, wstETH/WBTC on a short.
  availableDebtToken: bigint;
  // What the user wants to repay (in native debt-token units). The function
  // caps this against the debt ceiling and the post-fee available ceiling.
  desiredRepayAmount: bigint;
  // PoolConfiguration.getPoolFeeRatio(pool, operator)[3] for repay fee
  // (CONFIRMED in discovery-notes.md as index [3]; tuple is
  // [supplyFeeRatio, withdrawFeeRatio, borrowFeeRatio, repayFeeRatio]).
  // 1e9-denominated.
  repayFeeRatio: bigint;
  // Railgun's unshield fee in basis points (mainnet = 25).
  railgunUnshieldFeeBps: bigint;
  /**
   * The debt this position must RETAIN, in native `debtToken` units, so it
   * stays above the pool's `minDebtRatio`. From
   * {@link fxMinRemainingDebt} — or, end to end from chain state,
   * `getFxRepayCeiling()`.
   *
   * Optional, and omitting it is a real risk rather than a default. f(x)'s
   * final check in `_operate` is
   *
   * ```solidity
   * if (rawDebts * PRECISION * PRECISION < minDebtRatio * rawColls * op.price)
   *   revert ErrorDebtRatioTooSmall();
   * ```
   *
   * which a repay that does not touch collateral can trip from below. Measured
   * at head against live positions: a FULL repay reverts on every pool, and the
   * largest accepted repay is **99.97%** of debt on `wstETH-Long` but only
   * **89.16%** on `stETH-Short` — the shorts' `minDebtRatio` is 0.0909e18
   * against the longs' 0.0001e18, so on a short even a 99% repay reverts.
   *
   * Leave it undefined only when the caller has already bounded the repay some
   * other way. A batch that trips this mines with the repay swallowed.
   */
  minRemainingDebt?: bigint;
};

export type FxRepayAmounts = {
  // availableDebtToken × (10000 - 25) / 10000 — what lands in the executing
  // account (ephemeral EOA) after Railgun's unshield haircut.
  debtTokenAfterUnshield: bigint;
  // The largest repayAmount that can be supported by debtTokenAfterUnshield
  // given the f(x) repay fee uplift on PoolManager.transferFrom.
  maxRepayUnderFee: bigint;
  // The actual debt reduction f(x)'s operate() will perform. Capped at
  // min(maxRepayUnderFee, debt, desiredRepayAmount) and, when
  // `minRemainingDebt` is supplied, at `debt - minRemainingDebt`.
  repayAmount: bigint;
  /**
   * True when the min-debt-ratio floor is what bound `repayAmount` — the caller
   * could afford more and the position holds more, but f(x) will not let a
   * collateral-bearing position go that low.
   *
   * Surface it. "You asked to clear the debt and we repaid 89% of it" is a
   * result the user needs to see, and the alternative reading — that the wallet
   * silently under-repaid — is worse.
   */
  boundByMinDebtRatio: boolean;
  // What PoolManager will pull from the executing account (ephemeral EOA), including the
  // f(x) repay fee uplift: repayAmount × (1e9 + repayFeeRatio) / 1e9.
  // The recipe's ApproveERC20SpenderStep needs this exact value.
  approveAmount: bigint;
};

/**
 * The one place the type boundary provably cannot reach.
 *
 * A TypeScript caller who keeps passing `rawDebts` gets two compile errors (the
 * unknown property and the missing one). A plain-JS caller gets neither, and
 * `undefined < someBigint` evaluates to `false` rather than throwing — so the
 * debt ceiling would silently stop binding and `repayAmount` would exceed the
 * position's debt, surfacing as an `operate()` revert on chain instead of a
 * stack trace here.
 */
const assertNativeDebt = (debt: bigint, fn: string): void => {
  if (typeof debt !== 'bigint') {
    throw new Error(
      `fxmint: ${fn} — \`debt\` must be the position's debt in NATIVE debtToken ` +
        'units (getFxPosition().debt), not `rawDebts`. On the short pools the two ' +
        'differ by the manager token scaling factor.',
    );
  }
};

export function computeFxRepay(input: FxRepayInputs): FxRepayAmounts {
  const {
    debt,
    availableDebtToken,
    desiredRepayAmount,
    repayFeeRatio,
    railgunUnshieldFeeBps,
  } = input;

  assertNativeDebt(debt, 'computeFxRepay');

  if (railgunUnshieldFeeBps > BPS_DENOM) {
    throw new Error(
      `railgunUnshieldFeeBps must be <= ${BPS_DENOM}, got ${railgunUnshieldFeeBps}`,
    );
  }

  const debtTokenAfterUnshield =
    (availableDebtToken * (BPS_DENOM - railgunUnshieldFeeBps)) / BPS_DENOM;
  const maxRepayUnderFee =
    (debtTokenAfterUnshield * FEE_DENOM) / (FEE_DENOM + repayFeeRatio);

  // Four-way min: fee ceiling, debt ceiling, user's intent, and f(x)'s
  // min-debt-ratio floor. All four terms are native debt-token units — mixing a
  // raw ceiling in here is what let repayAmount exceed the position's actual
  // debt on the short pools.
  let repayAmount = maxRepayUnderFee;
  if (debt < repayAmount) repayAmount = debt;
  if (desiredRepayAmount < repayAmount) repayAmount = desiredRepayAmount;

  // The floor binds LAST, so `boundByMinDebtRatio` distinguishes "f(x) refused
  // to go lower" from "you could not afford more" — different messages for the
  // user and different next actions (close the position vs fund it).
  let boundByMinDebtRatio = false;
  const { minRemainingDebt } = input;
  if (minRemainingDebt !== undefined) {
    if (minRemainingDebt >= debt) {
      throw new Error(
        `fxmint: computeFxRepay — the position must retain ${minRemainingDebt} of ` +
          `its ${debt} debt to stay above the pool's minDebtRatio, so no repay is ` +
          'possible without withdrawing collateral. Close the position (which ' +
          'takes both legs to zero at once and is exempt) or top up collateral first.',
      );
    }
    const ceiling = debt - minRemainingDebt;
    if (ceiling < repayAmount) {
      repayAmount = ceiling;
      boundByMinDebtRatio = true;
    }
  }

  const approveAmount = (repayAmount * (FEE_DENOM + repayFeeRatio)) / FEE_DENOM;

  return {
    debtTokenAfterUnshield,
    maxRepayUnderFee,
    repayAmount,
    approveAmount,
    boundByMinDebtRatio,
  };
}

/**
 * The debt a position must RETAIN to stay above the pool's `minDebtRatio`,
 * in the same RAW units `getPosition()` reports.
 *
 * Mirrors f(x)'s final check in `BasePool._operate` exactly, rounded UP so the
 * caller stays on the accepting side of a `<`:
 *
 * ```solidity
 * if (rawDebts * PRECISION * PRECISION < minDebtRatio * rawColls * op.price)
 *   revert ErrorDebtRatioTooSmall();
 * ```
 *
 * `price` must be the pool oracle's **min** price — `getPrice()[1]`, the second
 * element. `_operate` reads that one (`(, op.price, ) = ...getPrice()`), not the
 * anchor at index 0. The three are within ~0.1% of each other, which is exactly
 * the margin that makes using the wrong one look correct in a test and revert
 * at the boundary.
 *
 * Validated against mainnet by bisecting the largest accepted repay on live
 * positions and comparing: the prediction matched on both `wstETH-Long` and
 * `stETH-Short` to within the bisection's own resolution.
 *
 * A full CLOSE is exempt and does not need this — it takes collateral to zero
 * in the same call, and the check reads `0 < minDebtRatio × 0 × price`, which is
 * false. The constraint binds only when collateral SURVIVES the operation.
 */
export const fxMinRemainingDebt = (input: {
  /** `getPosition()[0]` — raw collateral the position will still hold. */
  rawColls: bigint;
  /** `getDebtRatioRange()[0]`. */
  minDebtRatio: bigint;
  /** `priceOracle().getPrice()[1]` — the MIN price. */
  price: bigint;
}): bigint => {
  const { rawColls, minDebtRatio, price } = input;
  const numerator = minDebtRatio * rawColls * price;
  const denominator = FX_SCALE_PRECISION * FX_SCALE_PRECISION;
  // Ceiling division: the check is a strict `<`, so retaining exactly the
  // quotient passes and rounding down by one wei would not.
  return (numerator + denominator - 1n) / denominator;
};
