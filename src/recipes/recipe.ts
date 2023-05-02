import {
  RailgunERC20Amount,
  RailgunERC20AmountRecipient,
} from '@railgun-community/shared-models';
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
    firstInternalStepInput: StepInput,
  ): Promise<Step[]>;

  private async getFullSteps(firstStepInput: StepInput): Promise<Step[]> {
    const unshieldStep = new UnshieldStep();
    const unshieldOutput = await unshieldStep.getValidStepOutput(
      firstStepInput,
    );
    const firstInternalStepInput = this.createNextStepInput(
      firstStepInput,
      unshieldOutput,
    );
    const internalSteps = await this.getInternalSteps(firstInternalStepInput);
    return [unshieldStep, ...internalSteps, new ShieldStep()];
  }

  private createNextStepInput(
    firstStepInput: StepInput,
    stepOutput: StepOutput,
  ): StepInput {
    return {
      networkName: firstStepInput.networkName,
      erc20Amounts: stepOutput.outputERC20Amounts,
      nfts: stepOutput.outputNFTs,
    };
  }

  private createFirstStepInput(input: RecipeInput): StepInput {
    return {
      networkName: input.networkName,
      erc20Amounts: input.unshieldRecipeERC20Amounts.map(erc20Amount => {
        return {
          tokenAddress: erc20Amount.tokenAddress,
          isBaseToken: erc20Amount.isBaseToken,
          expectedBalance: erc20Amount.amount,
          minBalance: erc20Amount.amount,
          approvedSpender: undefined,
        };
      }),
      nfts: input.unshieldRecipeNFTs,
    };
  }

  async getStepOutputs(
    firstStepInput: StepInput,
    steps: Step[],
  ): Promise<StepOutput[]> {
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
    const firstStepInput = this.createFirstStepInput(input);
    const steps = await this.getFullSteps(firstStepInput);

    const stepOutputs = await this.getStepOutputs(firstStepInput, steps);
    if (!stepOutputs.length) {
      throw new Error('No step outputs were generated.');
    }

    const finalStepOutput = stepOutputs[stepOutputs.length - 1];

    const populatedTransactions = stepOutputs
      .map(output => output.populatedTransactions)
      .flat();

    const unshieldERC20Amounts: RailgunERC20Amount[] =
      input.unshieldRecipeERC20Amounts.map(unshieldERC20RecipeAmount => ({
        tokenAddress: unshieldERC20RecipeAmount.tokenAddress,
        amountString: unshieldERC20RecipeAmount.amount.toHexString(),
      }));
    const unshieldNFTs = input.unshieldRecipeNFTs;

    // TODO: After callbacks upgrade, remove unshield erc20s to auto re-shield.
    // Until then, we need all tokens to auto re-shield in case of revert.
    const shieldERC20Addresses: string[] = [];
    const erc20AmountsToReshield = [
      ...input.unshieldRecipeERC20Amounts,
      ...finalStepOutput.outputERC20Amounts,
    ];
    erc20AmountsToReshield.forEach(({ tokenAddress, isBaseToken }) => {
      if (isBaseToken) {
        return;
      }
      if (!shieldERC20Addresses.includes(tokenAddress)) {
        shieldERC20Addresses.push(tokenAddress);
      }
    });

    // TODO: After callbacks upgrade, remove unshield NFTs to auto re-shield.
    // Until then, we need all tokens to auto re-shield in case of revert.
    const shieldNFTs = [
      ...input.unshieldRecipeNFTs,
      ...finalStepOutput.outputNFTs,
    ];

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
      unshieldERC20Amounts,
      unshieldNFTs,
      shieldERC20Addresses,
      shieldNFTs,
      feeERC20AmountRecipients,
    };
    return recipeOutput;
  }
}
