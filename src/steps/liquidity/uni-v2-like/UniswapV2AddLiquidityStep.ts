import {
  RecipeAddLiquidityData,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeAddLiquidityStep } from './UniV2LikeAddLiquidityStep';

export class UniswapV2AddLiquidityStep extends UniV2LikeAddLiquidityStep {
  constructor(addLiquidityData: RecipeAddLiquidityData) {
    super(UniswapV2Fork.Uniswap, addLiquidityData);
  }
}
