import {
  RailgunERC20Amount,
  RailgunERC20AmountRecipient,
} from '@railgun-community/shared-models';
import {
  RecipeInput,
  RecipeOutput,
  StepInput,
  StepOutput,
} from '../models/export-models';
import { ShieldStep } from '../steps/railgun/shield-step';
import { UnshieldStep } from '../steps/railgun/unshield-step';
import { Step } from '../steps/step';
import {
  convertRecipeFeesToRailgunERC20AmountRecipients,
  convertStepOutputsToRailgunERC20Amounts,
} from '../utils/convert';

export abstract class Recipe {
  abstract readonly name: string;
  abstract readonly description: string;

  private internalSteps: Step[] = [];

  addStep(step: Step): void {
    if (!step.canAddStep) {
      throw new Error(`Cannot add Recipe Step: ${step.name}`);
    }

    this.internalSteps.push(step);
  }

  getFullSteps(): Step[] {
    return [new UnshieldStep(), ...this.internalSteps, new ShieldStep()];
  }

  private createFirstStepInput(input: RecipeInput): StepInput {
    return {
      networkName: input.networkName,
      erc20Amounts: input.unshieldERC20Amounts.map(erc20Amount => {
        return {
          ...erc20Amount,
          expectedBalance: erc20Amount.amount,
          minBalance: erc20Amount.amount,
        };
      }),
      nfts: input.unshieldNFTs,
    };
  }

  async getStepOutputs(input: RecipeInput): Promise<StepOutput[]> {
    const steps = this.getFullSteps();

    let stepInput: StepInput = this.createFirstStepInput(input);
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

    const shieldERC20Amounts: RailgunERC20Amount[] =
      convertStepOutputsToRailgunERC20Amounts(
        finalStepOutput.outputERC20Amounts,
      );
    const shieldNFTAmounts = finalStepOutput.outputNFTs;
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
      shieldERC20Amounts,
      shieldNFTAmounts,
      feeERC20AmountRecipients,
    };
    return recipeOutput;
  }
}
