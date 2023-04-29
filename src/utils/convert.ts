import {
  RailgunERC20Amount,
  RailgunERC20AmountRecipient,
} from '@railgun-community/shared-models';
import {
  RecipeERC20AmountRecipient,
  StepOutputERC20Amount,
} from '../models/export-models';

export const convertStepOutputsToRailgunERC20Amounts = (
  outputERC20Amounts: StepOutputERC20Amount[],
): RailgunERC20Amount[] => {
  return outputERC20Amounts.map(erc20Amount => {
    return {
      ...erc20Amount,
      amountString: erc20Amount.expectedBalance.toString(),
    };
  });
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
