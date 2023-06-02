import {
  ComboMealConfig,
  RecipeInput,
  RecipeOutput,
} from '../models/export-models';
import { Recipe } from '../recipes';
import { compareTokenAddress } from '../utils';

export abstract class ComboMeal {
  abstract readonly config: ComboMealConfig;

  protected abstract getRecipes(): Promise<Recipe[]>;

  private createNextRecipeInput(
    input: RecipeInput,
    output: RecipeOutput,
  ): RecipeInput {
    return {
      networkName: input.networkName,
      // TODO: Minimum balance is lost for combos. (amount is expectedBalance).
      erc20Amounts: output.erc20Amounts.filter(({ amount }) => amount > 0n),
      nfts: output.nfts,
    };
  }

  async getComboMealOutput(input: RecipeInput): Promise<RecipeOutput> {
    const recipes = await this.getRecipes();

    let nextInput = input;

    const aggregatedRecipeOutput: RecipeOutput = {
      stepOutputs: [],
      crossContractCalls: [],
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
      aggregatedRecipeOutput.crossContractCalls.push(
        ...recipeOutput.crossContractCalls,
      );
      aggregatedRecipeOutput.feeERC20AmountRecipients.push(
        ...recipeOutput.feeERC20AmountRecipients,
      );

      // Add amounts to remove any duplicates.
      recipeOutput.erc20Amounts.forEach(erc20Amount => {
        const found = aggregatedRecipeOutput.erc20Amounts.find(
          existingERC20Amount => {
            return compareTokenAddress(
              existingERC20Amount.tokenAddress,
              erc20Amount.tokenAddress,
            );
          },
        );
        if (found) {
          found.amount = found.amount + erc20Amount.amount;
          return;
        }
        aggregatedRecipeOutput.erc20Amounts.push(erc20Amount);
      });

      // Add amounts to remove any duplicates.
      recipeOutput.nfts.forEach(nft => {
        const found = aggregatedRecipeOutput.nfts.find(existingERC20Amount => {
          return (
            compareTokenAddress(
              existingERC20Amount.nftAddress,
              nft.nftAddress,
            ) &&
            nft.tokenSubID === existingERC20Amount.tokenSubID &&
            nft.nftTokenType === existingERC20Amount.nftTokenType
          );
        });
        if (found) {
          found.amount = found.amount + nft.amount;
          return;
        }
        aggregatedRecipeOutput.nfts.push(nft);
      });

      aggregatedRecipeOutput.nfts.push(...recipeOutput.nfts);
    }

    return aggregatedRecipeOutput;
  }
}
