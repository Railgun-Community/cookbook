import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import { ZeroXQuote } from '../../api/zero-x/zero-x-quote';
import { ZeroXSwapStep } from '../../steps/swap/zero-x/zero-x-swap-step';
import {
  RecipeConfig,
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
  SwapQuoteData,
  SwapQuoteParams,
} from '../../models/export-models';
import { SwapRecipe } from './swap-recipe';
import { NetworkName } from '@railgun-community/shared-models';
import { findFirstInputERC20Amount } from '../../utils';

export class ZeroXSwapRecipe extends SwapRecipe {
  readonly config: RecipeConfig = {
    name: '0x Exchange Swap',
    description: 'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
  };

  protected readonly sellERC20Info: RecipeERC20Info;
  protected readonly buyERC20Info: RecipeERC20Info;

  private readonly slippagePercentage: number;

  constructor(
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    slippagePercentage: number,
  ) {
    super();
    this.sellERC20Info = sellERC20Info;
    this.buyERC20Info = buyERC20Info;
    this.slippagePercentage = slippagePercentage;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return ZeroXQuote.supportsNetwork(networkName);
  }

  async getSwapQuote(
    networkName: NetworkName,
    sellERC20Amount: RecipeERC20Amount,
  ): Promise<SwapQuoteData> {
    const quoteParams: SwapQuoteParams = {
      networkName,
      sellERC20Amount,
      buyERC20Info: this.buyERC20Info,
      slippagePercentage: this.slippagePercentage,
      isRailgun: true,
    };
    return ZeroXQuote.getSwapQuote(quoteParams);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName } = firstInternalStepInput;
    const sellERC20Amount = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      this.sellERC20Info,
    );
    this.quote = await this.getSwapQuote(networkName, sellERC20Amount);

    return [
      new ApproveERC20SpenderStep(this.quote.spender, sellERC20Amount),
      new ZeroXSwapStep(this.quote, this.sellERC20Info),
    ];
  }
}
