import { RailgunNFTAmount } from '@railgun-community/shared-models';

/**
 * Canonical form of an NFT's `tokenSubID`.
 *
 * The same token id reaches us in more than one spelling: the fx steps derive
 * `'0x' + positionId.toString(16)` (unpadded, lowercase), while a wallet
 * enumerating shielded NFTs typically carries the 32-byte zero-padded form.
 * Both denote the same NFT, so they must key the same — otherwise an
 * integrator's padded id fails `Input NFT … must match NFT output`.
 *
 * Falls back to the lowercased raw string for any value that isn't numeric, so
 * an unexpected format degrades to exact-match rather than throwing.
 */
export const normalizeTokenSubID = (tokenSubID: string): string => {
  if (tokenSubID === '') {
    return '';
  }
  try {
    return `0x${BigInt(tokenSubID).toString(16)}`;
  } catch {
    return tokenSubID.toLowerCase();
  }
};

/**
 * Identity key for an NFT, stable across address checksum casing and
 * `tokenSubID` zero-padding.
 *
 * Single source of truth for "are these the same NFT?" — used by the step
 * validator, the recipe output aggregator, and the combo-meal seam. These three
 * previously keyed three slightly different ways, which is how a padded
 * `tokenSubID` could pass one and fail another.
 */
export const nftIdentityKey = (
  nft: Pick<RailgunNFTAmount, 'nftAddress' | 'tokenSubID' | 'nftTokenType'>,
): string => {
  return `${nft.nftAddress.toLowerCase()}-${normalizeTokenSubID(
    nft.tokenSubID,
  )}-${nft.nftTokenType}`;
};
