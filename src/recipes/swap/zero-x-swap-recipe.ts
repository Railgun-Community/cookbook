import { ApproveERC20SpenderStep } from '../../steps/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import { ZeroXQuote } from '../../api/zero-x/zero-x-quote';
import { ZeroXSwapStep } from '../../steps/zero-x/zero-x-swap-step';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
  SwapQuoteData,
  SwapQuoteParams,
} from '../../models/export-models';
import { SwapRecipe } from './swap-recipe';
import { NetworkName } from '@railgun-community/shared-models';

export class ZeroXSwapRecipe extends SwapRecipe {
  readonly config = {
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
    const sellERC20Amount = this.findFirstInputSellERC20Amount(
      firstInternalStepInput.erc20Amounts,
    );
    this.quote = await this.getSwapQuote(networkName, sellERC20Amount);

    return [
      new ApproveERC20SpenderStep(this.quote.spender, sellERC20Amount),
      new ZeroXSwapStep(this.quote, this.sellERC20Info),
    ];
  }
}
