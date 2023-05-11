import {
  ComboMealConfig,
  RecipeInput,
  RecipeOutput,
} from '../models/export-models';
import { Recipe } from '../recipes';

export abstract class ComboMeal {
  abstract readonly config: ComboMealConfig;

  protected abstract getRecipes(): Promise<Recipe[]>;

  private createNextRecipeInput(
    input: RecipeInput,
    output: RecipeOutput,
  ): RecipeInput {
    return {
      networkName: input.networkName,
      erc20Amounts: output.erc20Amounts,
      nfts: output.nfts,
    };
  }

  async getComboMealOutput(input: RecipeInput): Promise<RecipeOutput> {
    const recipes = await this.getRecipes();

    let nextInput = input;

    const aggregatedRecipeOutput: RecipeOutput = {
      stepOutputs: [],
      populatedTransactions: [],
      erc20Amounts: [],
      nfts: [],
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
      aggregatedRecipeOutput.erc20Amounts.push(...recipeOutput.erc20Amounts);
      aggregatedRecipeOutput.nfts.push(...recipeOutput.nfts);
      aggregatedRecipeOutput.feeERC20AmountRecipients.push(
        ...recipeOutput.feeERC20AmountRecipients,
      );
    }
    return aggregatedRecipeOutput;
  }
}
