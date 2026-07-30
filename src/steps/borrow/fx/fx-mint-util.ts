import { getAddress as ethersGetAddress } from 'ethers';

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

export type FxCloseInputs = {
  rawColls: bigint; // Pool.getPosition()[0]
  rawDebts: bigint; // Pool.getPosition()[1]
  collateralBalance: bigint; // PoolManager.getPoolInfo(pool)[1]
  totalRawColls: bigint; // Pool.getTotalRawCollaterals()
  shieldedFxUSD: bigint; // wallet.balanceForERC20Token(fxUSD)
  repayFeeRatio: bigint; // PoolConfiguration.getPoolFeeRatio(...)[3], 1e9-denominated
  railgunUnshieldFeeBps: bigint; // 25 on mainnet
};

export type FxCloseAmounts = {
  positionWstETH: bigint;
  fxUSDAfterUnshield: bigint;
  maxRepayUnderFee: bigint;
  repayAmount: bigint;
  approveAmount: bigint;
  withdrawColl: bigint;
  partialClose: boolean;
};

export function computeFxClose(input: FxCloseInputs): FxCloseAmounts {
  const { rawColls, rawDebts, collateralBalance, totalRawColls } = input;

  // Repay-side math: factored out so FxMintRepayDebtRecipe shares it.
  // For close, the user's "desired repay amount" is the entire debt — they
  // want to close as much as they can given fxUSD availability + fees.
  const repay = computeFxRepay({
    rawDebts,
    shieldedFxUSD: input.shieldedFxUSD,
    desiredRepayAmount: rawDebts,
    repayFeeRatio: input.repayFeeRatio,
    railgunUnshieldFeeBps: input.railgunUnshieldFeeBps,
  });

  // Collateral-side math: proportional withdraw at the repaid fraction.
  // f(x) has no withdraw fee, so this is a clean ratio. Note the variable
  // name is wstETH-Long-era — it's the native-collateral conversion
  // regardless of which pool (WBTC-Long uses 8-decimal WBTC). Renaming
  // would touch downstream callers, so out-of-scope here.
  const positionWstETH = (rawColls * collateralBalance) / totalRawColls;
  const withdrawColl = (positionWstETH * repay.repayAmount) / rawDebts;
  const partialClose = repay.repayAmount < rawDebts;

  // FxRepayAmounts is a strict subset of FxCloseAmounts's repay-side
  // fields (fxUSDAfterUnshield, maxRepayUnderFee, repayAmount,
  // approveAmount), so spreading is type-safe and avoids the verbose
  // per-field re-listing this used to do.
  return { ...repay, positionWstETH, withdrawColl, partialClose };
}

// =============================================================================
// Repay-side amount math, factored out so FxMintRepayDebtRecipe (which has
// no collateral side) can reuse the same fee accounting that computeFxClose
// uses for its repay leg. computeFxClose above delegates to this.
// =============================================================================

export type FxRepayInputs = {
  // Position's current debt in fxUSD wei (Pool.getPosition(positionId)[1]).
  rawDebts: bigint;
  // Caller's available shielded fxUSD; the recipe input balance.
  shieldedFxUSD: bigint;
  // What the user wants to repay (in fxUSD wei). The function caps this
  // against the rawDebts ceiling and the post-fee available ceiling.
  desiredRepayAmount: bigint;
  // PoolConfiguration.getPoolFeeRatio(pool, operator)[3] for repay fee
  // (CONFIRMED in discovery-notes.md as index [3]; tuple is
  // [supplyFeeRatio, withdrawFeeRatio, borrowFeeRatio, repayFeeRatio]).
  // 1e9-denominated.
  repayFeeRatio: bigint;
  // Railgun's unshield fee in basis points (mainnet = 25).
  railgunUnshieldFeeBps: bigint;
};

export type FxRepayAmounts = {
  // shieldedFxUSD × (10000 - 25) / 10000 — what lands in the executing account
  // (ephemeral EOA) after Railgun's unshield haircut.
  fxUSDAfterUnshield: bigint;
  // The largest repayAmount that can be supported by fxUSDAfterUnshield
  // given the f(x) repay fee uplift on PoolManager.transferFrom.
  maxRepayUnderFee: bigint;
  // The actual debt reduction f(x)'s operate() will perform. Capped at
  // min(maxRepayUnderFee, rawDebts, desiredRepayAmount).
  repayAmount: bigint;
  // What PoolManager will pull from the executing account (ephemeral EOA), including the
  // f(x) repay fee uplift: repayAmount × (1e9 + repayFeeRatio) / 1e9.
  // The recipe's ApproveERC20SpenderStep needs this exact value.
  approveAmount: bigint;
};

export function computeFxRepay(input: FxRepayInputs): FxRepayAmounts {
  const {
    rawDebts,
    shieldedFxUSD,
    desiredRepayAmount,
    repayFeeRatio,
    railgunUnshieldFeeBps,
  } = input;

  if (railgunUnshieldFeeBps > BPS_DENOM) {
    throw new Error(
      `railgunUnshieldFeeBps must be <= ${BPS_DENOM}, got ${railgunUnshieldFeeBps}`,
    );
  }

  const fxUSDAfterUnshield =
    (shieldedFxUSD * (BPS_DENOM - railgunUnshieldFeeBps)) / BPS_DENOM;
  const maxRepayUnderFee =
    (fxUSDAfterUnshield * FEE_DENOM) / (FEE_DENOM + repayFeeRatio);

  // Three-way min: fee ceiling, debt ceiling, user's intent.
  let repayAmount = maxRepayUnderFee;
  if (rawDebts < repayAmount) repayAmount = rawDebts;
  if (desiredRepayAmount < repayAmount) repayAmount = desiredRepayAmount;

  const approveAmount = (repayAmount * (FEE_DENOM + repayFeeRatio)) / FEE_DENOM;

  return { fxUSDAfterUnshield, maxRepayUnderFee, repayAmount, approveAmount };
}
