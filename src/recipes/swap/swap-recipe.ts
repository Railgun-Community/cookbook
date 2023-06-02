import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeOutput,
  SwapQuoteData,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils';
import { Recipe } from '../recipe';
import { CookbookDebug } from '../../utils/cookbook-debug';

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

  getBuySellAmountsFromRecipeOutput(
    recipeOutput: Optional<RecipeOutput>,
  ): Optional<{
    sellFee: bigint;
    buyAmount: bigint;
    buyMinimum: bigint;
    buyFee: bigint;
  }> {
    try {
      if (!recipeOutput) {
        return undefined;
      }

      const unshieldStepOutput = recipeOutput.stepOutputs[0];
      const unshieldFee = unshieldStepOutput.feeERC20AmountRecipients?.find(
        fee => {
          return compareERC20Info(fee, this.sellERC20Info);
        },
      );
      if (!unshieldFee) {
        throw new Error('Expected unshield fee to match sell token.');
      }

      const shieldStepOutput =
        recipeOutput.stepOutputs[recipeOutput.stepOutputs.length - 1];
      const shieldFee = shieldStepOutput.feeERC20AmountRecipients?.find(fee => {
        return compareERC20Info(fee, this.buyERC20Info);
      });
      if (!shieldFee) {
        throw new Error('Expected shield fee to match buy token.');
      }

      const output = shieldStepOutput.outputERC20Amounts.find(outputAmount => {
        return compareERC20Info(outputAmount, this.buyERC20Info);
      });
      if (!output) {
        throw new Error('Expected output to match buy token.');
      }

      return {
        sellFee: unshieldFee.amount,
        buyAmount: output.expectedBalance,
        buyMinimum: output.minBalance,
        buyFee: shieldFee.amount,
      };
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      CookbookDebug.error(err);
      return undefined;
    }
  }
}
