import { isDefined } from '@railgun-community/shared-models';
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

  /**
   * When true, the seam feeds each downstream recipe the worst-case (minimum)
   * balance of the previous recipe's outputs instead of the optimistic expected
   * amount. A combo whose downstream recipe bakes an EXACT on-chain amount from a
   * NON-DETERMINISTIC upstream output (e.g. a 0x swap feeding an ERC-4626
   * deposit, or a redeem feeding a swap) MUST enable this — otherwise the batch
   * reverts whenever the upstream underfills within slippage. Default false
   * preserves behavior for combos whose downstream consumes the actual on-EOA
   * balance regardless (e.g. Beefy `depositAll`).
   */
  protected conservativeSeamAmounts(): boolean {
    return false;
  }

  private createNextRecipeInput(
    input: RecipeInput,
    output: RecipeOutput,
  ): RecipeInput {
    const conservative = this.conservativeSeamAmounts();
    return {
      railgunAddress: input.railgunAddress,
      networkName: input.networkName,
      // The recipient `amount` is expectedBalance; a conservative seam instead
      // uses the carried worst-case `minBalance`, so a downstream exact-amount
      // call can never exceed what the upstream is guaranteed to deliver.
      erc20Amounts: output.erc20AmountRecipients
        .map(recipient =>
          conservative && isDefined(recipient.minBalance)
            ? { ...recipient, amount: recipient.minBalance }
            : recipient,
        )
        .filter(({ amount }) => amount > 0n),
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
