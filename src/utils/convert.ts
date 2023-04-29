import { RailgunERC20AmountRecipient } from '@railgun-community/shared-models';
import {
  RecipeERC20AmountRecipient,
  StepOutputERC20Amount,
} from '../models/export-models';

export const convertStepOutputsToERC20TokenAddresses = (
  outputERC20Amounts: StepOutputERC20Amount[],
): string[] => {
  return outputERC20Amounts.map(erc20Amount => erc20Amount.tokenAddress);
};

export const convertRecipeFeesToRailgunERC20AmountRecipients = (
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[],
): RailgunERC20AmountRecipient[] => {
  return feeERC20AmountRecipients.map(recipeERC20AmountRecipient => ({
    tokenAddress: recipeERC20AmountRecipient.tokenAddress,
    amountString: recipeERC20AmountRecipient.amount.toString(),
    recipientAddress: recipeERC20AmountRecipient.recipient,
  }));
};
