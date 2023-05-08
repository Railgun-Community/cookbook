import {
  RecipeRemoveLiquidityData,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeRemoveLiquidityStep } from './uni-v2-like-remove-liquidity-step';

export class SushiswapV2RemoveLiquidityStep extends UniV2LikeRemoveLiquidityStep {
  constructor(addLiquidityData: RecipeRemoveLiquidityData) {
    super(UniswapV2Fork.Sushiswap, addLiquidityData);
  }
}
