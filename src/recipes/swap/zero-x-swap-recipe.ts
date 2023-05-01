import { Recipe } from '../recipe';
import { ApproveERC20SpenderStep } from '../../steps/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import {
  ZeroXSwapQuoteParams,
  zeroXGetSwapQuote,
} from '../../api/zero-x/zero-x-quote';
import { ZeroXSwapStep } from '../../steps/zero-x/zero-x-swap-step';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
} from '../../models';
import { compareERC20Info } from '../../utils/token';

export class ZeroXSwapRecipe extends Recipe {
  readonly name = '0x Exchange Swap';
  readonly description =
    'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.';

  private readonly sellERC20Info: RecipeERC20Info;
  private readonly buyERC20Info: RecipeERC20Info;
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

  private getSellERC20Amount(
    erc20Amounts: StepOutputERC20Amount[],
  ): RecipeERC20Amount {
    const outputERC20Amount = erc20Amounts.find(erc20Amount =>
      compareERC20Info(erc20Amount, this.sellERC20Info),
    );
    if (!outputERC20Amount) {
      throw new Error(
        `Swap Recipe Input must contain sell ERC20 Amount: ${this.sellERC20Info.tokenAddress}`,
      );
    }
    return {
      tokenAddress: outputERC20Amount.tokenAddress,
      amount: outputERC20Amount.minBalance,
    };
  }

  protected async getInternalSteps(firstStepInput: StepInput): Promise<Step[]> {
    const sellERC20Amount = this.getSellERC20Amount(
      firstStepInput.erc20Amounts,
    );
    const quoteParams: ZeroXSwapQuoteParams = {
      networkName: firstStepInput.networkName,
      sellERC20Amount,
      buyERC20Info: this.buyERC20Info,
      slippagePercentage: this.slippagePercentage,
    };
    const quote = await zeroXGetSwapQuote(quoteParams);

    return [
      new ApproveERC20SpenderStep(quote.spender, sellERC20Amount.tokenAddress),
      new ZeroXSwapStep(quote),
    ];
  }
}
