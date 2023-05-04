import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  StepOutputERC20Amount,
  SwapQuoteData,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils';
import { Recipe } from '../recipe';

export abstract class SwapRecipe extends Recipe {
  protected quote: Optional<SwapQuoteData>;

  protected abstract readonly sellERC20Info: RecipeERC20Info;
  protected abstract readonly buyERC20Info: RecipeERC20Info;

  getLatestQuote(): Optional<SwapQuoteData> {
    return this.quote;
  }

  protected abstract getSwapQuote(
    networkName: NetworkName,
    sellERC20Amount: RecipeERC20Amount,
  ): Promise<SwapQuoteData>;

  protected findFirstInputSellERC20Amount(
    inputERC20Amounts: StepOutputERC20Amount[],
  ): RecipeERC20Amount {
    const inputERC20Amount = inputERC20Amounts.find(erc20Amount =>
      compareERC20Info(erc20Amount, this.sellERC20Info),
    );
    if (!inputERC20Amount) {
      throw new Error(
        `SwapRecipe first input must contain sell ERC20 Amount: ${this.sellERC20Info.tokenAddress}`,
      );
    }
    return {
      tokenAddress: inputERC20Amount.tokenAddress,
      amount: inputERC20Amount.expectedBalance,
    };
  }
}
