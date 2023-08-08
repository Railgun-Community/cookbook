import { NetworkName, isDefined } from '@railgun-community/shared-models';
import {
  RecipeERC20Amount,
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  RecipeOutput,
  StepOutputERC20Amount,
  SwapQuoteData,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils';
import { Recipe } from '../recipe';
import { CookbookDebug } from '../../utils/cookbook-debug';

export abstract class SwapRecipe extends Recipe {
  protected quote: Optional<SwapQuoteData>;

  protected abstract readonly sellERC20Info: RecipeERC20Info;
  protected abstract readonly buyERC20Info: RecipeERC20Info;

  protected readonly destinationAddress: Optional<string>;

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
    sellUnshieldFee: bigint;
    buyAmount: bigint;
    buyMinimum: bigint;
    buyShieldFee: bigint;
  }> {
    try {
      if (!recipeOutput) {
        return undefined;
      }

      const firstOutputIndex = 0;
      const unshieldStepOutput = recipeOutput.stepOutputs[firstOutputIndex];
      const unshieldFee = unshieldStepOutput.feeERC20AmountRecipients?.find(
        fee => {
          return compareERC20Info(fee, this.sellERC20Info);
        },
      );
      if (!unshieldFee) {
        throw new Error('Expected unshield fee to match sell token.');
      }

      const swapStepOutput = recipeOutput.stepOutputs[2];
      if (swapStepOutput.name !== '0x Exchange Swap') {
        throw new Error('Expected step output 3 to be 0x Exchange Swap.');
      }

      let buyOutput: Optional<StepOutputERC20Amount>;
      let buyShieldFee: Optional<RecipeERC20AmountRecipient>;

      if (isDefined(this.destinationAddress)) {
        // If there's a destination address:
        // Buy output is from swap value, which is transferred out before it's shielded.
        buyOutput = swapStepOutput.outputERC20Amounts.find(outputAmount => {
          return compareERC20Info(outputAmount, this.buyERC20Info);
        });
        if (!buyOutput) {
          throw new Error('Expected swap output to match buy token.');
        }
      } else {
        // If there's no destination address:
        // Buy output is from final shield value.
        const lastOutputIndex = recipeOutput.stepOutputs.length - 1;
        const shieldStepOutput = recipeOutput.stepOutputs[lastOutputIndex];
        buyOutput = shieldStepOutput.outputERC20Amounts.find(outputAmount => {
          return compareERC20Info(outputAmount, this.buyERC20Info);
        });
        if (!buyOutput) {
          throw new Error('Expected swap output to match buy token.');
        }
        buyShieldFee = shieldStepOutput.feeERC20AmountRecipients?.find(fee => {
          return compareERC20Info(fee, this.buyERC20Info);
        });
        if (!buyShieldFee) {
          throw new Error('Expected shield fee to match buy token.');
        }
      }

      return {
        sellUnshieldFee: unshieldFee.amount,
        buyAmount: buyOutput.expectedBalance,
        buyMinimum: buyOutput.minBalance,
        buyShieldFee: buyShieldFee?.amount ?? 0n,
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
