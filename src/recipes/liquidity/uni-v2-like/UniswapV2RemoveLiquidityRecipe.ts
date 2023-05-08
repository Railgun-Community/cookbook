import { BaseProvider } from '@ethersproject/providers';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeRemoveLiquidityRecipe } from './UniV2LikeRemoveLiquidityRecipe';

export class UniswapV2RemoveLiquidityRecipe extends UniV2LikeRemoveLiquidityRecipe {
  constructor(
    lpERC20Amount: RecipeERC20Amount,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: BaseProvider,
  ) {
    super(
      UniswapV2Fork.Uniswap,
      lpERC20Amount,
      erc20InfoA,
      erc20InfoB,
      slippagePercentage,
      provider,
    );
  }
}
