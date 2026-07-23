import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueLiquidationRecipe } from '../../recipes/morpho/blue-liquidation-recipe';
import { MarketParams } from '../../steps/morpho/morpho-blue-util';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Private liquidation: liquidate an unhealthy Morpho Blue borrower, then swap
 * the seized collateral into a desired asset and shield the profit — in one
 * combo.
 *
 * ```
 * unshield repay asset → liquidate → seized collateral → 0x swap → shield profit
 * ```
 *
 * `sellERC20Info` MUST be the market's collateral token (the seized asset). A
 * flash-loan-funded variant (Bundler3) that shields only net profit is a future
 * addition — express it via `MorphoTransactRecipe` (the transaction compiler).
 */
export class MorphoLiquidation_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'Morpho Liquidation + 0x Swap',
    description:
      'Liquidates a Morpho Blue borrower and swaps the seized collateral into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly liquidationRecipe: MorphoBlueLiquidationRecipe;
  private readonly swapRecipe: ZeroXV2SwapRecipe;

  constructor(
    market: MarketParams,
    borrower: string,
    seizedCollateralAssets: bigint,
    liquidationSlippageBasisPoints: bigint,
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    swapSlippageBasisPoints: number,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super();
    const executor = resolveExecutorAddress(
      recipient,
      'MorphoLiquidation_ZeroXSwap_ComboMeal recipient',
    );
    this.liquidationRecipe = new MorphoBlueLiquidationRecipe(
      market,
      borrower,
      seizedCollateralAssets,
      liquidationSlippageBasisPoints,
      provider,
    );
    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.liquidationRecipe, this.swapRecipe];
  }
}
