import { isDefined } from '@railgun-community/shared-models';
import {
  ComboMealConfig,
  RecipeInput,
  RecipeOutput,
} from '../models/export-models';
import { Recipe } from '../recipes';
import { compareTokenAddress, nftIdentityKey } from '../utils';

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

    // A combo executes every constituent recipe in ONE batch, so it cannot
    // possibly need less gas than the dearest recipe it contains. This used to
    // emit `this.config.minGasLimit` verbatim, which let a combo declare a floor
    // *below* its own worst leg — five of the seven shipped combos did, because
    // they all take the generic MIN_GAS_LIMIT_COMBO_MEAL while wrapping recipes
    // sized higher. The floor is enforced in-contract as a `gasleft()` require,
    // so declaring too little under-provisions the batch and reverts it at the
    // shield epilogue with the value stranded at the executor.
    //
    // Taking the max here fixes the whole class at the seam rather than
    // per-combo, and it cannot lower any existing floor. It deliberately does
    // NOT invent a value: a combo's own config still wins whenever it is the
    // larger number, which is the right answer once the constituent floors are
    // re-measured on the 7702 path.
    const minGasLimit = recipes.reduce(
      (floor, recipe) =>
        recipe.config.minGasLimit > floor ? recipe.config.minGasLimit : floor,
      this.config.minGasLimit,
    );

    const aggregatedRecipeOutput: RecipeOutput = {
      name: this.config.name,
      stepOutputs: [],
      crossContractCalls: [],
      erc20AmountRecipients: [],
      nftRecipients: [],
      feeERC20AmountRecipients: [],
      outputPositions: [],
      minGasLimit,
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

      // Concatenate — NOT last-writer-wins like the NFT branch below, and not
      // summed like the ERC20 branch above.
      //
      // Both of those exist because an ARTIFACT that transits the seam is
      // re-declared by every recipe it passes through, so one thing appears N
      // times and the declarations have to be reconciled. A position record is
      // not an artifact but an event, and it does not transit the seam at all:
      // `createNextRecipeInput` builds the next RecipeInput from
      // `erc20AmountRecipients` and `nftRecipients` only, and neither
      // RecipeInput nor StepInput has a positions channel to carry one. A step
      // emits a record only when it itself changes a position.
      //
      // So two records for the same (protocol, market, owner, kind) across the
      // seam mean two real changes — a combo that borrows in one recipe and
      // borrows again in the next — and last-writer-wins would silently drop
      // the second. Note this is the opposite conclusion from the NFT case for
      // the same underlying reason, not in spite of it: a bearer position's NFT
      // still dedupes in `nftRecipients` (it is a balance), while the records
      // describing what happened to that position accumulate (they are events).
      aggregatedRecipeOutput.outputPositions.push(
        ...recipeOutput.outputPositions,
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

      // Last writer wins — do NOT sum, as the ERC20 branch above does.
      //
      // An NFT that transits the seam is re-declared by every recipe it passes
      // through: each recipe's own final step emits it (see
      // Recipe.getRecipeOutput — `amount: isFinalStep ? outputNFT.amount : 0n`).
      // Summing those declarations yields amount 2n for an ERC-721, which
      // validateStepOutputNFTs rejects outright. The downstream recipe's amount
      // is the terminal state of the NFT: 1n survived, 0n burned.
      recipeOutput.nftRecipients.forEach(nftRecipient => {
        const found = aggregatedRecipeOutput.nftRecipients.find(
          existingNFTRecipient => {
            return (
              nftIdentityKey(existingNFTRecipient) ===
                nftIdentityKey(nftRecipient) &&
              existingNFTRecipient.recipient === nftRecipient.recipient
            );
          },
        );
        if (found) {
          found.amount = nftRecipient.amount;
          return;
        }
        aggregatedRecipeOutput.nftRecipients.push(nftRecipient);
      });
    }

    return aggregatedRecipeOutput;
  }
}
