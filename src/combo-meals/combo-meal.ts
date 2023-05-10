import {
  ComboMealConfig,
  RecipeInput,
  RecipeOutput,
} from '../models/export-models';
import { Recipe } from '../recipes';

export abstract class ComboMeal {
  abstract readonly config: ComboMealConfig;

  protected abstract getInternalRecipes(): Promise<Recipe[]>;

  private createNextRecipeInput(
    input: RecipeInput,
    output: RecipeOutput,
  ): RecipeInput {
    return {
      networkName: input.networkName,
      erc20Amounts: output.shieldERC20Amounts,
      nfts: output.shieldNFTs,
    };
  }

  async getComboMealOutput(input: RecipeInput): Promise<RecipeOutput> {
    const recipes = await this.getInternalRecipes();

    let nextInput = input;

    const aggregatedRecipeOutput: RecipeOutput = {
      stepOutputs: [],
      populatedTransactions: [],
      shieldERC20Amounts: [],
      shieldNFTs: [],
      feeERC20AmountRecipients: [],
    };

    for (let i = 0; i < recipes.length; i++) {
      const isFirst = i === 0;
      const isLast = i === recipes.length - 1;
      const recipe = recipes[i];

      const recipeOutput = await recipe.getRecipeOutput(
        nextInput,
        !isFirst, // skipUnshield
        !isLast, // skipShield
      );
      nextInput = this.createNextRecipeInput(nextInput, recipeOutput);

      aggregatedRecipeOutput.stepOutputs.push(...recipeOutput.stepOutputs);
      aggregatedRecipeOutput.populatedTransactions.push(
        ...recipeOutput.populatedTransactions,
      );
      aggregatedRecipeOutput.shieldERC20Amounts.push(
        ...recipeOutput.shieldERC20Amounts,
      );
      aggregatedRecipeOutput.shieldNFTs.push(...recipeOutput.shieldNFTs);
      aggregatedRecipeOutput.feeERC20AmountRecipients.push(
        ...recipeOutput.feeERC20AmountRecipients,
      );
    }
    return aggregatedRecipeOutput;
  }
}
