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
export const LIQUIDATION_CURSOR = 3n * 10n ** 17n; // 0.3e18
export const MAX_LIQUIDATION_INCENTIVE_FACTOR = 115n * 10n ** 16n; // 1.15e18
export const VIRTUAL_SHARES = 10n ** 6n;
export const VIRTUAL_ASSETS = 1n;

// MathLib
const mulDivDown = (x: bigint, y: bigint, d: bigint): bigint => (x * y) / d;
const mulDivUp = (x: bigint, y: bigint, d: bigint): bigint =>
  (x * y + (d - 1n)) / d;
const wMulDown = (x: bigint, y: bigint): bigint => mulDivDown(x, y, WAD);
const wDivDown = (x: bigint, y: bigint): bigint => mulDivDown(x, WAD, y);
const wDivUp = (x: bigint, y: bigint): bigint => mulDivUp(x, WAD, y);

// SharesMathLib
const toSharesUp = (
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivUp(assets, totalShares + VIRTUAL_SHARES, totalAssets + VIRTUAL_ASSETS);
const toAssetsUp = (
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint =>
  mulDivUp(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);

/**
 * Liquidation incentive factor for a market, from its LLTV — matches Morpho's
 * `min(MAX_LIF, WAD / (WAD - CURSOR * (WAD - lltv)))`.
 */
export const liquidationIncentiveFactor = (lltv: bigint): bigint => {
  const computed = wDivDown(
    WAD,
    WAD - wMulDown(LIQUIDATION_CURSOR, WAD - lltv),
  );
  return computed < MAX_LIQUIDATION_INCENTIVE_FACTOR
    ? computed
    : MAX_LIQUIDATION_INCENTIVE_FACTOR;
};

/**
 * Exact loan-token amount Morpho pulls from the liquidator when seizing
 * `seizedAssets` of collateral — replicates Morpho.liquidate()'s seize path:
 * quote the collateral, divide by the incentive factor, round up to borrow
 * shares, then up to assets.
 */
export const computeRepaidAssetsFromSeized = (params: {
  seizedAssets: bigint;
  collateralPrice: bigint;
  lltv: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
}): bigint => {
  const {
    seizedAssets,
    collateralPrice,
    lltv,
    totalBorrowAssets,
    totalBorrowShares,
  } = params;
  const lif = liquidationIncentiveFactor(lltv);
  const seizedAssetsQuoted = mulDivUp(
    seizedAssets,
    collateralPrice,
    ORACLE_PRICE_SCALE,
  );
  const repaidShares = toSharesUp(
    wDivUp(seizedAssetsQuoted, lif),
    totalBorrowAssets,
    totalBorrowShares,
  );
  return toAssetsUp(repaidShares, totalBorrowAssets, totalBorrowShares);
};
