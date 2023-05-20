import {
  RecipeERC20Info,
  RecipeNFTInfo,
  StepOutputERC20Amount,
} from '../models/export-models';
import { compareERC20Info } from './token';

export type ERC20AmountFilter = (erc20Amount: StepOutputERC20Amount) => boolean;

export type NFTAmountFilter = (nftAmount: RecipeNFTInfo) => boolean;

export const filterERC20AmountInputs = (
  inputERC20Amounts: StepOutputERC20Amount[],
  filter: ERC20AmountFilter,
): {
  erc20AmountsForStep: StepOutputERC20Amount[];
  unusedERC20Amounts: StepOutputERC20Amount[];
} => {
  const erc20AmountsForStep = inputERC20Amounts.filter(filter);
  const unusedERC20Amounts = inputERC20Amounts.filter(
    erc20Amount => !filter(erc20Amount),
  );
  return { erc20AmountsForStep, unusedERC20Amounts };
};

export const filterNFTAmountInputs = (
  inputNFTAmounts: RecipeNFTInfo[],
  filter: NFTAmountFilter,
): {
  nftAmountsForStep: RecipeNFTInfo[];
  unusedNFTAmounts: RecipeNFTInfo[];
} => {
  const nftAmountsForStep = inputNFTAmounts.filter(filter);
  const unusedNFTAmounts = inputNFTAmounts.filter(
    erc20Amount => !filter(erc20Amount),
  );
  return { nftAmountsForStep, unusedNFTAmounts };
};

export const findFirstInputERC20Amount = (
  inputERC20Amounts: StepOutputERC20Amount[],
  erc20Info: RecipeERC20Info,
) => {
  const inputERC20Amount = inputERC20Amounts.find(erc20Amount =>
    compareERC20Info(erc20Amount, erc20Info),
  );
  if (!inputERC20Amount) {
    throw new Error(
      `First input for this recipe must contain ERC20 Amount: ${erc20Info.tokenAddress}.`,
    );
  }
  return {
    tokenAddress: inputERC20Amount.tokenAddress,
    decimals: inputERC20Amount.decimals,
    amount: inputERC20Amount.expectedBalance,
  };
};
