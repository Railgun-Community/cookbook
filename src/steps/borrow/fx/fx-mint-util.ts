import { getAddress, type Address } from 'viem';

// =============================================================================
// f(x) Protocol mainnet addresses (immutable contracts, sourced from
// @aladdindao/fx-sdk@1.0.5 dist/index.cjs and verified on Etherscan).
// =============================================================================

export const FX_ADDRESSES = {
  WETH: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  wstETH: getAddress('0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'),
  fxUSD: getAddress('0x085780639CC2cACd35E474e71f4d000e2405d8f6'),
  fxPoolManager: getAddress('0x250893CA4Ba5d05626C785e8da758026928FCD24'),
  // Note: there is no single "position NFT" address — each pool IS its own
  // ERC-721 NFT contract (Pool inherits the ERC-721 interface). Use
  // `pool.address` from KNOWN_POOLS / resolvePool for outputNFTs.nftAddress.
  fxPoolConfiguration: getAddress('0x16b334f2644cc00b85DB1A1efF0C2C395e00C28d'),
} as const satisfies Record<string, Address>;

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
// Pool registry (currently 2 mainnet pools: wstETH-Long, WBTC-Long).
// =============================================================================

export type FxMintPoolName = 'wstETH-Long' | 'WBTC-Long';

// FxMintPoolRef accepts either a registered pool name or a fully-specified
// custom-pool object. The custom-pool branch carries collateralDecimals
// because cookbook's amount accounting needs the right native-decimals
// value (WBTC = 8, wstETH = 18). For named pools the value is supplied
// from KNOWN_POOLS internally.
export type FxMintPoolRef =
  | FxMintPoolName
  | {
      address: Address;
      collateralToken: Address;
      collateralDecimals: bigint;
    };

type FxPoolEntry = {
  name: FxMintPoolName;
  address: Address;
  collateralToken: Address;
  // Native-units decimals for the collateral token. f(x)'s `operate()`
  // takes raw amounts in this native scale; cookbook's amount metadata
  // must match or its accounting will be off by 10^(18-decimals).
  collateralDecimals: bigint;
};

export const KNOWN_POOLS: readonly FxPoolEntry[] = [
  {
    name: 'wstETH-Long',
    address: getAddress('0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'),
    collateralToken: FX_ADDRESSES.wstETH,
    collateralDecimals: 18n,
  },
  {
    name: 'WBTC-Long',
    address: getAddress('0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'),
    collateralToken: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
    collateralDecimals: 8n,
  },
] as const;

export type ResolvedFxPool = {
  address: Address;
  collateralToken: Address;
  collateralDecimals: bigint;
};

export function resolvePool(ref: FxMintPoolRef): ResolvedFxPool {
  if (typeof ref === 'string') {
    const found = KNOWN_POOLS.find((p) => p.name === ref);
    if (!found) {
      throw new Error(
        `Unknown fxMINT pool name: ${ref}. Known pools: ${KNOWN_POOLS.map((p) => p.name).join(', ')}`,
      );
    }
    return {
      address: found.address,
      collateralToken: found.collateralToken,
      collateralDecimals: found.collateralDecimals,
    };
  }
  return {
    address: getAddress(ref.address),
    collateralToken: getAddress(ref.collateralToken),
    collateralDecimals: ref.collateralDecimals,
  };
}

// =============================================================================
// Close-side amount math.
// =============================================================================

export const FEE_DENOM = 1_000_000_000n;
export const BPS_DENOM = 10_000n;

export type FxCloseInputs = {
  rawColls: bigint;                   // Pool.getPosition()[0]
  rawDebts: bigint;                   // Pool.getPosition()[1]
  collateralBalance: bigint;          // PoolManager.getPoolInfo(pool)[1]
  totalRawColls: bigint;              // Pool.getTotalRawCollaterals()
  shieldedFxUSD: bigint;              // wallet.balanceForERC20Token(fxUSD)
  repayFeeRatio: bigint;              // PoolConfiguration.getPoolFeeRatio(...)[3], 1e9-denominated
  railgunUnshieldFeeBps: bigint;      // 25 on mainnet
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

  return {
    positionWstETH,
    fxUSDAfterUnshield: repay.fxUSDAfterUnshield,
    maxRepayUnderFee: repay.maxRepayUnderFee,
    repayAmount: repay.repayAmount,
    approveAmount: repay.approveAmount,
    withdrawColl,
    partialClose,
  };
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
  // shieldedFxUSD × (10000 - 25) / 10000 — what lands in the relay-adapter
  // after Railgun's unshield haircut.
  fxUSDAfterUnshield: bigint;
  // The largest repayAmount that can be supported by fxUSDAfterUnshield
  // given the f(x) repay fee uplift on PoolManager.transferFrom.
  maxRepayUnderFee: bigint;
  // The actual debt reduction f(x)'s operate() will perform. Capped at
  // min(maxRepayUnderFee, rawDebts, desiredRepayAmount).
  repayAmount: bigint;
  // What PoolManager will pull from the relay-adapter, including the
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
    throw new Error(`railgunUnshieldFeeBps must be <= ${BPS_DENOM}, got ${railgunUnshieldFeeBps}`);
  }

  const fxUSDAfterUnshield = (shieldedFxUSD * (BPS_DENOM - railgunUnshieldFeeBps)) / BPS_DENOM;
  const maxRepayUnderFee = (fxUSDAfterUnshield * FEE_DENOM) / (FEE_DENOM + repayFeeRatio);

  // Three-way min: fee ceiling, debt ceiling, user's intent.
  let repayAmount = maxRepayUnderFee;
  if (rawDebts < repayAmount) repayAmount = rawDebts;
  if (desiredRepayAmount < repayAmount) repayAmount = desiredRepayAmount;

  const approveAmount = (repayAmount * (FEE_DENOM + repayFeeRatio)) / FEE_DENOM;

  return { fxUSDAfterUnshield, maxRepayUnderFee, repayAmount, approveAmount };
}
