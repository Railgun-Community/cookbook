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

// MathLib
const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint =>
  (x * y + (d - 1n)) / d;

// SharesMathLib
const toAssetsUp = (
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

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
