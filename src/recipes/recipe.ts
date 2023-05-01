import { RailgunERC20AmountRecipient } from '@railgun-community/shared-models';
import {
  RecipeConfig,
  RecipeInput,
  RecipeOutput,
  StepInput,
  StepOutput,
} from '../models/export-models';
import { ShieldStep } from '../steps/railgun/shield-step';
import { UnshieldStep } from '../steps/railgun/unshield-step';
import { Step } from '../steps/step';
import { convertRecipeFeesToRailgunERC20AmountRecipients } from '../utils/convert';

export abstract class Recipe {
  abstract readonly config: RecipeConfig;

  protected abstract getInternalSteps(
    firstStepInput: StepInput,
  ): Promise<Step[]>;

  private async getFullSteps(firstStepInput: StepInput): Promise<Step[]> {
    const internalSteps = await this.getInternalSteps(firstStepInput);
    return [new UnshieldStep(), ...internalSteps, new ShieldStep()];
  }

  private createFirstStepInput(input: RecipeInput): StepInput {
    return {
      networkName: input.networkName,
      erc20Amounts: input.unshieldERC20Amounts.map(erc20Amount => {
        return {
          ...erc20Amount,
          expectedBalance: erc20Amount.amount,
          minBalance: erc20Amount.amount,
          approvedForSpender: undefined,
        };
      }),
      nfts: input.unshieldNFTs,
    };
  }

  async getStepOutputs(input: RecipeInput): Promise<StepOutput[]> {
    const firstStepInput = this.createFirstStepInput(input);
    const steps = await this.getFullSteps(firstStepInput);

    let stepInput: StepInput = firstStepInput;
    let stepOutput: Optional<StepOutput>;

    const stepOutputs: StepOutput[] = [];

    for (const step of steps) {
      if (stepOutput) {
        stepInput = {
          networkName: stepInput.networkName,
          erc20Amounts: stepOutput.outputERC20Amounts,
          nfts: stepOutput.outputNFTs,
        };
      }
      stepOutput = await step.getValidStepOutput(stepInput);
      stepOutputs.push(stepOutput);
    }

    return stepOutputs;
  }

  async getRecipeOutput(input: RecipeInput): Promise<RecipeOutput> {
    const stepOutputs = await this.getStepOutputs(input);
    if (!stepOutputs.length) {
      throw new Error('No step outputs were generated.');
    }
    const finalStepOutput = stepOutputs[stepOutputs.length - 1];

    const populatedTransactions = stepOutputs
      .map(output => output.populatedTransactions)
      .flat();

    // TODO: After callbacks upgrade, remove unshield erc20s to auto re-shield.
    // Until then, we need all tokens to auto re-shield in case of revert.
    const shieldERC20Addresses: string[] = [];
    const tokenAmountsToReshield = [
      ...input.unshieldERC20Amounts,
      ...finalStepOutput.outputERC20Amounts,
    ];
    tokenAmountsToReshield.forEach(({ tokenAddress, isBaseToken }) => {
      if (isBaseToken) {
        return;
      }
      if (!shieldERC20Addresses.includes(tokenAddress)) {
        shieldERC20Addresses.push(tokenAddress);
      }
    });

    // TODO: After callbacks upgrade, remove unshield NFTs to auto re-shield.
    // Until then, we need all tokens to auto re-shield in case of revert.
    const shieldNFTs = [...input.unshieldNFTs, ...finalStepOutput.outputNFTs];

    const feeERC20AmountRecipients: RailgunERC20AmountRecipient[] = stepOutputs
      .map(output =>
        convertRecipeFeesToRailgunERC20AmountRecipients(
          output.feeERC20AmountRecipients,
        ),
      )
      .flat();

    const recipeOutput: RecipeOutput = {
      stepOutputs,
      populatedTransactions,
      shieldERC20Addresses,
      shieldNFTs,
      feeERC20AmountRecipients,
    };
    return recipeOutput;
  }
}
