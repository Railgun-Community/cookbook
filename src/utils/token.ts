import { RecipeERC20Info } from '../models/export-models';

export const compareERC20Info = (
  tokenA: RecipeERC20Info,
  tokenB: RecipeERC20Info,
): boolean => {
  return (
    tokenA.tokenAddress.toLowerCase() === tokenB.tokenAddress.toLowerCase() &&
    !!tokenA.isBaseToken === !!tokenB.isBaseToken
  );
};
