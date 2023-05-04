import {
  RecipeERC20Info,
  StepOutputERC20Amount,
} from '../models/export-models';

const compareTokenAddress = (a: string, b: string): boolean => {
  return a.toLowerCase() === b.toLowerCase();
};

export const compareERC20Info = (
  tokenA: RecipeERC20Info,
  tokenB: RecipeERC20Info,
): boolean => {
  return (
    compareTokenAddress(tokenA.tokenAddress, tokenB.tokenAddress) &&
    !!tokenA.isBaseToken === !!tokenB.isBaseToken
  );
};

export const isApprovedForSpender = (
  erc20Amount: StepOutputERC20Amount,
  spender: Optional<string>,
) => {
  return !spender || erc20Amount.approvedSpender === spender;
};
