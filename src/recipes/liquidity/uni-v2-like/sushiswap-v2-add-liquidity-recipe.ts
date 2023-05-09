import { BaseProvider } from '@ethersproject/providers';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeAddLiquidityRecipe } from './uni-v2-like-add-liquidity-recipe';

export class SushiswapV2AddLiquidityRecipe extends UniV2LikeAddLiquidityRecipe {
  constructor(
    erc20AmountA: RecipeERC20Amount,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: BaseProvider,
  ) {
    super(
      UniswapV2Fork.Sushiswap,
      erc20AmountA,
      erc20InfoB,
      slippagePercentage,
      provider,
    );
  }
}
