import { Recipe } from '../recipe';
import { ApproveERC20SpenderStep } from '../../steps/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import {
  ZeroXQuote,
  ZeroXSwapQuoteData,
  ZeroXSwapQuoteParams,
} from '../../api/zero-x/zero-x-quote';
import { ZeroXSwapStep } from '../../steps/zero-x/zero-x-swap-step';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';

export class ZeroXSwapRecipe extends Recipe {
  readonly config = {
    name: '0x Exchange Swap',
    description: 'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
  };

  private readonly sellERC20Info: RecipeERC20Info;
  private readonly buyERC20Info: RecipeERC20Info;
  private readonly slippagePercentage: number;

  private quote: Optional<ZeroXSwapQuoteData>;

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

  getLatestQuote(): Optional<ZeroXSwapQuoteData> {
    return this.quote;
  }

  private findInputSellERC20Amount(
    inputERC20Amounts: StepOutputERC20Amount[],
  ): RecipeERC20Amount {
    const inputERC20Amount = inputERC20Amounts.find(erc20Amount =>
      compareERC20Info(erc20Amount, this.sellERC20Info),
    );
    if (!inputERC20Amount) {
      throw new Error(
        `Swap Recipe inputs must contain sell ERC20 Amount: ${this.sellERC20Info.tokenAddress}`,
      );
    }
    return {
      tokenAddress: inputERC20Amount.tokenAddress,
      amount: inputERC20Amount.expectedBalance,
    };
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const sellERC20Amount = this.findInputSellERC20Amount(
      firstInternalStepInput.erc20Amounts,
    );
    const quoteParams: ZeroXSwapQuoteParams = {
      networkName: firstInternalStepInput.networkName,
      sellERC20Amount,
      buyERC20Info: this.buyERC20Info,
      slippagePercentage: this.slippagePercentage,
      isRailgun: true,
    };
    this.quote = await ZeroXQuote.getSwapQuote(quoteParams);

    return [
      new ApproveERC20SpenderStep(
        this.quote.spender,
        sellERC20Amount.tokenAddress,
      ),
      new ZeroXSwapStep(this.quote, this.sellERC20Info),
    ];
  }
}
