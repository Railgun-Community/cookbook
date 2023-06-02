import {
  RecipeERC20Amount,
  RecipeOutput,
  RecipeRemoveLiquidityData,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils';
import { Recipe } from '../recipe';
import { CookbookDebug } from '../../utils/cookbook-debug';

import { NetworkName } from '@railgun-community/shared-models';

export abstract class RemoveLiquidityRecipe extends Recipe {
  removeLiquidityData: Optional<RecipeRemoveLiquidityData>;

  protected abstract getRemoveLiquidityData(
    networkName: NetworkName,
    lpERC20Amount: RecipeERC20Amount,
  ): Promise<RecipeRemoveLiquidityData>;

  getExpectedABAmountsFromRecipeOutput(
    recipeOutput: Optional<RecipeOutput>,
  ): Optional<{
    lpUnshieldFee: bigint;
    aAmount: bigint;
    aMinimum: bigint;
    bAmount: bigint;
    bMinimum: bigint;
    aShieldFee: bigint;
    bShieldFee: bigint;
  }> {
    try {
      if (!recipeOutput) {
        return undefined;
      }
      if (!this.removeLiquidityData) {
        return undefined;
      }

      const { lpERC20Amount, expectedERC20AmountA, expectedERC20AmountB } =
        this.removeLiquidityData;

      const unshieldStepOutput = recipeOutput.stepOutputs[0];
      const unshieldFee = unshieldStepOutput.feeERC20AmountRecipients?.find(
        fee => {
          return compareERC20Info(fee, lpERC20Amount);
        },
      );
      if (!unshieldFee) {
        throw new Error('Expected unshield fee to match LP token.');
      }

      const shieldStepOutput =
        recipeOutput.stepOutputs[recipeOutput.stepOutputs.length - 1];
      const shieldFeeA = shieldStepOutput.feeERC20AmountRecipients?.find(
        fee => {
          return compareERC20Info(fee, expectedERC20AmountA);
        },
      );
      if (!shieldFeeA) {
        throw new Error('Expected one shield fee to match token A.');
      }
      const shieldFeeB = shieldStepOutput.feeERC20AmountRecipients?.find(
        fee => {
          return compareERC20Info(fee, expectedERC20AmountB);
        },
      );
      if (!shieldFeeB) {
        throw new Error('Expected one shield fee to match token B.');
      }

      const outputA = shieldStepOutput.outputERC20Amounts.find(outputAmount => {
        return compareERC20Info(outputAmount, expectedERC20AmountA);
      });
      if (!outputA) {
        throw new Error('Expected one output to match token A.');
      }
      const outputB = shieldStepOutput.outputERC20Amounts.find(outputAmount => {
        return compareERC20Info(outputAmount, expectedERC20AmountB);
      });
      if (!outputB) {
        throw new Error('Expected one output to match token B.');
      }

      return {
        lpUnshieldFee: unshieldFee.amount,
        aAmount: outputA.expectedBalance,
        aMinimum: outputA.minBalance,
        bAmount: outputB.expectedBalance,
        bMinimum: outputB.minBalance,
        aShieldFee: shieldFeeA.amount,
        bShieldFee: shieldFeeB.amount,
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
