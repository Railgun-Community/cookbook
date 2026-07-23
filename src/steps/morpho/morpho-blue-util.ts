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
