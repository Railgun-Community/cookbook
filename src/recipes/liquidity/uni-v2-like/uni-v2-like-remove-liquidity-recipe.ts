import {
  RecipeConfig,
  RecipeERC20Info,
  RecipeRemoveLiquidityData,
  StepInput,
  UniswapV2Fork,
} from '../../../models/export-models';
import { UniV2LikeSDK } from '../../../api/uniswap/uni-v2-like-sdk';
import { NetworkName } from '@railgun-community/shared-models';
import { RecipeERC20Amount } from '../../../models';
import { ApproveERC20SpenderStep } from '../../../steps/token/erc20/approve-erc20-spender-step';
import { UniV2LikeRemoveLiquidityStep } from '../../../steps/liquidity/uni-v2-like/uni-v2-like-remove-liquidity-step';

import { Step } from '../../../steps/step';
import { RemoveLiquidityRecipe } from '../remove-liquidity-recipe';
import { findFirstInputERC20Amount } from '../../../utils/filters';
import { Provider } from 'ethers';

export class UniV2LikeRemoveLiquidityRecipe extends RemoveLiquidityRecipe {
  readonly config: RecipeConfig = {
    name: '[Name] Remove Liquidity',
    description: 'Removes liquidity from a [NAME] Pool.',
  };

  private readonly uniswapV2Fork: UniswapV2Fork;

  private readonly lpERC20Info: RecipeERC20Info;
  private readonly erc20InfoA: RecipeERC20Info;
  private readonly erc20InfoB: RecipeERC20Info;

  private readonly slippagePercentage: number;
  private readonly provider: Provider;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    lpERC20Info: RecipeERC20Info,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippagePercentage: number,
    provider: Provider,
  ) {
    super();
    this.uniswapV2Fork = uniswapV2Fork;

    this.lpERC20Info = lpERC20Info;
    this.erc20InfoA = erc20InfoA;
    this.erc20InfoB = erc20InfoB;

    this.slippagePercentage = slippagePercentage;
    this.provider = provider;

    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Remove Liquidity`;
    this.config.description = `Removes liquidity from a ${forkName} Pool.`;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return UniV2LikeSDK.supportsForkAndNetwork(this.uniswapV2Fork, networkName);
  }

  async getRemoveLiquidityData(
    networkName: NetworkName,
    lpERC20Amount: RecipeERC20Amount,
  ): Promise<RecipeRemoveLiquidityData> {
    this.removeLiquidityData = await UniV2LikeSDK.getRemoveLiquidityData(
      this.uniswapV2Fork,
      networkName,
      lpERC20Amount,
      this.erc20InfoA,
      this.erc20InfoB,
      this.slippagePercentage,
      this.provider,
    );
    return this.removeLiquidityData;
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName, erc20Amounts } = firstInternalStepInput;

    const lpERC20Amount = findFirstInputERC20Amount(
      erc20Amounts,
      this.lpERC20Info,
    );
    const removeLiquidityData = await this.getRemoveLiquidityData(
      networkName,
      lpERC20Amount,
    );

    return [
      new ApproveERC20SpenderStep(
        removeLiquidityData.routerContractAddress,
        this.lpERC20Info,
      ),
      new UniV2LikeRemoveLiquidityStep(this.uniswapV2Fork, removeLiquidityData),
    ];
  }
}
