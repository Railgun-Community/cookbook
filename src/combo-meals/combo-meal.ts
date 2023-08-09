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
      railgunAddress: input.railgunAddress,
      networkName: input.networkName,
      // TODO: Minimum balance is lost for combos. (amount is expectedBalance).
      erc20Amounts: output.erc20AmountRecipients.filter(
        ({ amount }) => amount > 0n,
      ),
      nfts: output.nftRecipients,
    };
  }

  async getComboMealOutput(input: RecipeInput): Promise<RecipeOutput> {
    const recipes = await this.getRecipes();

    let nextInput = input;

    const aggregatedRecipeOutput: RecipeOutput = {
      name: this.config.name,
      stepOutputs: [],
      crossContractCalls: [],
      erc20AmountRecipients: [],
      nftRecipients: [],
      feeERC20AmountRecipients: [],
      minGasLimit: this.config.minGasLimit,
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
      recipeOutput.erc20AmountRecipients.forEach(erc20AmountRecipient => {
        const found = aggregatedRecipeOutput.erc20AmountRecipients.find(
          existingERC20Amount => {
            return (
              compareTokenAddress(
                existingERC20Amount.tokenAddress,
                erc20AmountRecipient.tokenAddress,
              ) &&
              existingERC20Amount.recipient === erc20AmountRecipient.recipient
            );
          },
        );
        if (found) {
          found.amount = found.amount + erc20AmountRecipient.amount;
          return;
        }
        aggregatedRecipeOutput.erc20AmountRecipients.push(erc20AmountRecipient);
      });

      // Add amounts to remove any duplicates.
      recipeOutput.nftRecipients.forEach(nftRecipient => {
        const found = aggregatedRecipeOutput.nftRecipients.find(
          existingNFTRecipient => {
            return (
              compareTokenAddress(
                existingNFTRecipient.nftAddress,
                nftRecipient.nftAddress,
              ) &&
              nftRecipient.tokenSubID === existingNFTRecipient.tokenSubID &&
              nftRecipient.nftTokenType === existingNFTRecipient.nftTokenType &&
              existingNFTRecipient.recipient === nftRecipient.recipient
            );
          },
        );
        if (found) {
          found.amount = found.amount + nftRecipient.amount;
          return;
        }
        aggregatedRecipeOutput.nftRecipients.push(nftRecipient);
      });
    }

    return aggregatedRecipeOutput;
  }
}
