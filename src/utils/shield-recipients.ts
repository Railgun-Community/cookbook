import {
  RailgunERC20Recipient,
  RailgunNFTAmountRecipient,
} from '@railgun-community/shared-models';
import {
  RecipeERC20AmountRecipient,
  RecipeNFTRecipient,
  RecipeOutput,
} from '../models/export-models';

/**
 * Shield arguments for the wallet SDK's cross-contract-call entry points, in
 * the shape those functions expect.
 *
 * Field names match the local variables the SDK call sites use
 * (`shieldERC20Recipients` / `shieldNFTRecipients`), so a caller can destructure
 * straight into `gasEstimateForUnprovenCrossContractCalls`,
 * `generateCrossContractCallsProof`, their `*7702` counterparts, and
 * `populateProvedCrossContractCalls`.
 */
export type ShieldRecipients = {
  shieldERC20Recipients: RailgunERC20Recipient[];
  shieldNFTRecipients: RailgunNFTAmountRecipient[];
};

/**
 * Map a `RecipeOutput`'s ERC20 recipients onto the SDK's
 * `RailgunERC20Recipient`.
 *
 * Two things diverge and both are deliberate:
 *
 *  1. **`recipient` -> `recipientAddress`.** The cookbook field is *not*
 *     renamed at the source, because `RecipeERC20AmountRecipient` is
 *     polymorphic: on `RecipeOutput.erc20AmountRecipients` it holds an address
 *     (a `0zk` shield target by default, or a designated public `0x` one), but
 *     the same type carries human-readable labels on step `spentERC20Amounts`
 *     and `feeERC20AmountRecipients` — `'Morpho Blue Market'`,
 *     `'0x V2 Exchange'`, `` `${vaultName} Vault Deposit Fee` ``. Renaming the
 *     field would assert "this is an address" over values that deliberately are
 *     not. The rename belongs at this boundary, where the polymorphism has
 *     already been resolved to the address case.
 *
 *  2. **`amount` is dropped.** A shield recipient is a *designation*, not an
 *     amount: relay-adapt re-shields the executor's whole balance of each token
 *     at the end of the batch, so `RailgunERC20Recipient` carries no amount.
 *     `RecipeOutput.erc20AmountRecipients[].amount` is the recipe's expected
 *     value and is validation-only. `decimals`, `isBaseToken` and `minBalance`
 *     are likewise cookbook-side metadata.
 *
 * Fields are therefore constructed explicitly rather than spread, so no
 * cookbook-side field can leak into arguments the SDK caches and later compares
 * field-by-field in `validateCachedProvedTransaction`.
 */
export const createShieldERC20Recipients = (
  erc20AmountRecipients: RecipeERC20AmountRecipient[],
): RailgunERC20Recipient[] => {
  return erc20AmountRecipients.map(erc20AmountRecipient => ({
    tokenAddress: erc20AmountRecipient.tokenAddress,
    recipientAddress: erc20AmountRecipient.recipient,
  }));
};

/**
 * Map a `RecipeOutput`'s NFT recipients onto the SDK's
 * `RailgunNFTAmountRecipient`.
 *
 * The NFT divergence is narrower than the ERC20 one — `RecipeNFTRecipient`
 * already extends `RailgunNFTAmount`, so `nftAddress`, `nftTokenType`,
 * `tokenSubID` and `amount` pass through unchanged and only `recipient` is
 * renamed. Notably `amount` *is* carried here, unlike the ERC20 case: an NFT
 * shield is per-token-id, so the SDK needs the count (1 for ERC721, n for
 * ERC1155).
 */
export const createShieldNFTRecipients = (
  nftRecipients: RecipeNFTRecipient[],
): RailgunNFTAmountRecipient[] => {
  return nftRecipients.map(nftRecipient => ({
    nftAddress: nftRecipient.nftAddress,
    nftTokenType: nftRecipient.nftTokenType,
    tokenSubID: nftRecipient.tokenSubID,
    amount: nftRecipient.amount,
    recipientAddress: nftRecipient.recipient,
  }));
};

/**
 * Canonical cookbook -> wallet-SDK shield-argument adapter.
 *
 * Every consumer of a `RecipeOutput` must perform this mapping before calling
 * the SDK, and it was previously hand-rolled at each call site. Shipping it
 * means the ERC20/NFT divergences above are stated once, in the published
 * surface, instead of re-derived per integrator.
 *
 * Takes the two fields it reads rather than a whole `RecipeOutput`, so a
 * partially-aggregated output (a ComboMeal seam, a designate-shield recipe)
 * works without a cast.
 */
export const createShieldRecipients = (
  recipeOutput: Pick<RecipeOutput, 'erc20AmountRecipients' | 'nftRecipients'>,
): ShieldRecipients => {
  return {
    shieldERC20Recipients: createShieldERC20Recipients(
      recipeOutput.erc20AmountRecipients,
    ),
    shieldNFTRecipients: createShieldNFTRecipients(recipeOutput.nftRecipients),
  };
};
