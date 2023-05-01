import { Recipe } from '../recipe';
import { BigNumber } from '@ethersproject/bignumber';
import { ApproveERC20SpenderStep } from '../../steps/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import {
  ZeroXSwapQuoteData,
  ZeroXSwapQuoteParams,
  zeroXGetSwapQuote,
} from '../../api/zero-x/zero-x-quote';
import { CookbookDebug } from '../../utils/cookbook-debug';

export class ZeroXSwapRecipe extends Recipe {
  readonly name = '0x Exchange Swap';
  readonly description =
    'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.';

  private readonly quoteParams: ZeroXSwapQuoteParams;

  constructor(quoteParams: ZeroXSwapQuoteParams) {
    super();
    this.quoteParams = quoteParams;
  }

  private async getSwapQuote(): Promise<ZeroXSwapQuoteData> {
    const { quote, error } = await zeroXGetSwapQuote(this.quoteParams);
    if (error) {
      CookbookDebug.error(error);
      throw error;
    }
    if (!quote) {
      throw new Error('Could not retrieve 0x Quote.');
    }
    return quote;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    const { spender, sellTokenValue } = await this.getSwapQuote();
    const sellTokenAmount = BigNumber.from(sellTokenValue);

    return [
      new ApproveERC20SpenderStep(spender, sellTokenAmount),
      // TODO: Add Swap
    ];
  }
}
