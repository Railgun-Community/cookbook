import { RecipeERC20Info } from '../models';

export const compareERC20Info = (
  tokenA: RecipeERC20Info,
  tokenB: RecipeERC20Info,
): boolean => {
  return (
    tokenA.tokenAddress === tokenB.tokenAddress &&
    tokenA.isBaseToken == tokenB.isBaseToken
  );
};
