import {
  ComboMealConfig,
  RecipeERC20Amount,
  RecipeERC20Info,
  UniswapV2Fork,
} from '../../models/export-models';
import { Recipe } from '../../recipes';
import { UniV2LikeAddLiquidityRecipe } from '../../recipes/liquidity/uni-v2-like/uni-v2-like-add-liquidity-recipe';
import { BeefyDepositRecipe } from '../../recipes/vault/beefy/beefy-deposit-recipe';
import { ComboMeal } from '../combo-meal';
import { UniV2LikeSDK } from '../../api/uniswap/uni-v2-like-sdk';
import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';

export class UniV2LikeAddLiquidity_BeefyDeposit_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '[NAME] Add Liquidity + Beefy Vault Deposit Combo Meal',
    description:
      'Adds liquidity to a [NAME] Pool and deposits the LP tokens into a Beefy Vault.',
  };

  private readonly uniV2LikeAddLiquidityRecipe: UniV2LikeAddLiquidityRecipe;

  private readonly beefyDepositRecipe: BeefyDepositRecipe;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    vaultID: string,
    provider: Provider,
  ) {
    super();

    this.uniV2LikeAddLiquidityRecipe = new UniV2LikeAddLiquidityRecipe(
      uniswapV2Fork,
      erc20InfoA,
      erc20InfoB,
      slippagePercentage,
      provider,
    );
    this.beefyDepositRecipe = new BeefyDepositRecipe(vaultID);

    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Add Liquidity + Beefy Vault Deposit Combo Meal`;
    this.config.description = `Adds liquidity to a ${forkName} Pool and deposits the LP tokens into a Beefy Vault.`;
  }

  getAddLiquidityAmountBForUnshield(
    networkName: NetworkName,
    targetUnshieldERC20AmountA: RecipeERC20Amount,
  ) {
    return this.uniV2LikeAddLiquidityRecipe.getAddLiquidityAmountBForUnshield(
      networkName,
      targetUnshieldERC20AmountA,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.uniV2LikeAddLiquidityRecipe, this.beefyDepositRecipe];
  }
}
