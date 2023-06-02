import { Provider } from 'ethers';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';
import { UniV2LikeRemoveLiquidityRecipe } from './uni-v2-like-remove-liquidity-recipe';

export class SushiswapV2RemoveLiquidityRecipe extends UniV2LikeRemoveLiquidityRecipe {
  constructor(
    lpERC20Info: RecipeERC20Info,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: Provider,
  ) {
    super(
      UniswapV2Fork.Sushiswap,
      lpERC20Info,
      erc20InfoA,
      erc20InfoB,
      slippagePercentage,
      provider,
    );
  }
}
