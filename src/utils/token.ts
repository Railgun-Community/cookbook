import {
  RecipeERC20Info,
  StepOutputERC20Amount,
} from '../models/export-models';

export const compareERC20Info = (
  tokenA: RecipeERC20Info,
  tokenB: RecipeERC20Info,
): boolean => {
  return (
    tokenA.tokenAddress.toLowerCase() === tokenB.tokenAddress.toLowerCase() &&
    !!tokenA.isBaseToken === !!tokenB.isBaseToken
  );
};

export const isApprovedForSpender = (
  erc20Amount: StepOutputERC20Amount,
  spender: Optional<string>,
) => {
  return !spender || erc20Amount.approvedSpender === spender;
};
