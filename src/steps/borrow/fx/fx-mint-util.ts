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
  fxPositionNFT: getAddress('0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'),
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

export type FxMintPoolRef =
  | FxMintPoolName
  | { address: Address; collateralToken: Address };

type FxPoolEntry = {
  name: FxMintPoolName;
  address: Address;
  collateralToken: Address;
};

export const KNOWN_POOLS: readonly FxPoolEntry[] = [
  {
    name: 'wstETH-Long',
    address: getAddress('0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'),
    collateralToken: FX_ADDRESSES.wstETH,
  },
  {
    name: 'WBTC-Long',
    address: getAddress('0xAB709e26Fa6B0A30c119D8c55B887DeD24952473'),
    collateralToken: getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'),
  },
] as const;

export function resolvePool(ref: FxMintPoolRef): { address: Address; collateralToken: Address } {
  if (typeof ref === 'string') {
    const found = KNOWN_POOLS.find((p) => p.name === ref);
    if (!found) {
      throw new Error(`Unknown fxMINT pool name: ${ref}. Known pools: ${KNOWN_POOLS.map((p) => p.name).join(', ')}`);
    }
    return { address: found.address, collateralToken: found.collateralToken };
  }
  return { address: getAddress(ref.address), collateralToken: getAddress(ref.collateralToken) };
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
  const { rawColls, rawDebts, collateralBalance, totalRawColls, shieldedFxUSD, repayFeeRatio, railgunUnshieldFeeBps } = input;

  if (railgunUnshieldFeeBps > BPS_DENOM) {
    throw new Error(`railgunUnshieldFeeBps must be <= ${BPS_DENOM}, got ${railgunUnshieldFeeBps}`);
  }

  const positionWstETH = (rawColls * collateralBalance) / totalRawColls;
  const fxUSDAfterUnshield = (shieldedFxUSD * (BPS_DENOM - railgunUnshieldFeeBps)) / BPS_DENOM;
  const maxRepayUnderFee = (fxUSDAfterUnshield * FEE_DENOM) / (FEE_DENOM + repayFeeRatio);
  const repayAmount = maxRepayUnderFee < rawDebts ? maxRepayUnderFee : rawDebts;
  const approveAmount = (repayAmount * (FEE_DENOM + repayFeeRatio)) / FEE_DENOM;
  const withdrawColl = (positionWstETH * repayAmount) / rawDebts;
  const partialClose = repayAmount < rawDebts;

  return { positionWstETH, fxUSDAfterUnshield, maxRepayUnderFee, repayAmount, approveAmount, withdrawColl, partialClose };
}
