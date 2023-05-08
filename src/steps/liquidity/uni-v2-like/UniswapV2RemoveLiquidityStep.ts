import {
  RecipeRemoveLiquidityData,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeRemoveLiquidityStep } from './UniV2LikeRemoveLiquidityStep';

export class UniswapV2RemoveLiquidityStep extends UniV2LikeRemoveLiquidityStep {
  constructor(addLiquidityData: RecipeRemoveLiquidityData) {
    super(UniswapV2Fork.Uniswap, addLiquidityData);
  }
}
