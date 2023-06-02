import { Provider } from 'ethers';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';
import { UniV2LikeAddLiquidityRecipe } from './uni-v2-like-add-liquidity-recipe';

export class SushiswapV2AddLiquidityRecipe extends UniV2LikeAddLiquidityRecipe {
  constructor(
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: Provider,
  ) {
    super(
      UniswapV2Fork.Sushiswap,
      erc20InfoA,
      erc20InfoB,
      slippagePercentage,
      provider,
    );
  }
}
