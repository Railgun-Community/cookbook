import {
  RecipeAddLiquidityData,
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeSDK } from '../../../api/uniswap/uni-v2-like-sdk';
import { NetworkName } from '@railgun-community/shared-models';
import { RecipeERC20Amount } from '../../../models';
import { ApproveERC20SpenderStep } from '../../../steps/token/erc20/approve-erc20-spender-step';
import { UniV2LikeAddLiquidityStep } from '../../../steps/liquidity/uni-v2-like/uni-v2-like-add-liquidity-step';

import { Step } from '../../../steps/step';
import { AddLiquidityRecipe } from '../add-liquidity-recipe';
import { findFirstInputERC20Amount } from '../../../utils/filters';
import {
  getAmountToUnshieldForTarget,
  getUnshieldedAmountAfterFee,
} from '../../../utils/fee';
import { Provider } from 'ethers';

export class UniV2LikeAddLiquidityRecipe extends AddLiquidityRecipe {
  readonly config: RecipeConfig = {
    name: '[Name] Add Liquidity',
    description: 'Adds liquidity to a [Name] Pool.',
  };

  private readonly uniswapV2Fork: UniswapV2Fork;

  private readonly erc20InfoA: RecipeERC20Info;
  private readonly erc20InfoB: RecipeERC20Info;

  private readonly slippagePercentage: number;
  private readonly provider: Provider;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: Provider,
  ) {
    super();
    this.uniswapV2Fork = uniswapV2Fork;

    this.erc20InfoA = erc20InfoA;
    this.erc20InfoB = erc20InfoB;
    this.slippagePercentage = slippagePercentage;
    this.provider = provider;

    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Add Liquidity`;
    this.config.description = `Adds liquidity to a ${forkName} Pool.`;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return UniV2LikeSDK.supportsForkAndNetwork(this.uniswapV2Fork, networkName);
  }

  private async getAddLiquidityData(
    networkName: NetworkName,
    erc20AmountA: RecipeERC20Amount,
  ): Promise<RecipeAddLiquidityData> {
    this.addLiquidityData = await UniV2LikeSDK.getAddLiquidityData(
      this.uniswapV2Fork,
      networkName,
      erc20AmountA,
      this.erc20InfoB,
      this.slippagePercentage,
      this.provider,
    );
    return this.addLiquidityData;
  }

  /**
   * This will return the amount of ERC20 B that is proportional to the amounts in the LP Pool,
   * adjusting for unshield fees on either end.
   */
  async getAddLiquidityAmountBForUnshield(
    networkName: NetworkName,
    targetUnshieldERC20AmountA: RecipeERC20Amount,
  ): Promise<{
    erc20UnshieldAmountB: RecipeERC20Amount;
    addLiquidityData: RecipeAddLiquidityData;
  }> {
    const unshieldedAmountA = getUnshieldedAmountAfterFee(
      networkName,
      targetUnshieldERC20AmountA.amount,
    );
    const unshieldedERC20AmountA: RecipeERC20Amount = {
      ...targetUnshieldERC20AmountA,
      amount: unshieldedAmountA,
    };
    this.addLiquidityData = await this.getAddLiquidityData(
      networkName,
      unshieldedERC20AmountA,
    );
    const preUnshieldAmountB = getAmountToUnshieldForTarget(
      networkName,
      this.addLiquidityData.erc20AmountB.amount,
    );
    const erc20UnshieldAmountB: RecipeERC20Amount = {
      ...this.addLiquidityData.erc20AmountB,
      amount: preUnshieldAmountB,
    };
    return {
      erc20UnshieldAmountB,
      addLiquidityData: this.addLiquidityData,
    };
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName, erc20Amounts } = firstInternalStepInput;

    const erc20AmountA = findFirstInputERC20Amount(
      erc20Amounts,
      this.erc20InfoA,
    );
    this.addLiquidityData = await this.getAddLiquidityData(
      networkName,
      erc20AmountA,
    );

    return [
      new ApproveERC20SpenderStep(
        this.addLiquidityData.routerContractAddress,
        this.erc20InfoA,
      ),
      new ApproveERC20SpenderStep(
        this.addLiquidityData.routerContractAddress,
        this.erc20InfoB,
      ),
      new UniV2LikeAddLiquidityStep(this.uniswapV2Fork, this.addLiquidityData),
    ];
  }
}
