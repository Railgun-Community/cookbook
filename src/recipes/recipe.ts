import {
  NetworkName,
  RailgunNFTAmount,
} from '@railgun-community/shared-models';
import {
  RecipeConfig,
  RecipeERC20Amount,
  RecipeERC20AmountRecipient,
  RecipeInput,
  RecipeOutput,
  StepInput,
  StepOutput,
} from '../models/export-models';
import { ShieldStep } from '../steps/railgun/shield-step';
import { UnshieldStep } from '../steps/railgun/unshield-step';
import { Step } from '../steps/step';
import { BigNumber } from 'ethers';

export abstract class Recipe {
  abstract readonly config: RecipeConfig;

  protected abstract getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]>;

  protected abstract supportsNetwork(networkName: NetworkName): boolean;

  private async getFullSteps(
    firstStepInput: StepInput,
    skipUnshield: boolean,
    skipShield: boolean,
  ): Promise<Step[]> {
    if (skipUnshield) {
      const internalSteps = await this.getInternalSteps(firstStepInput);
      return skipShield ? internalSteps : [...internalSteps, new ShieldStep()];
    }
    const unshieldStep = new UnshieldStep();
    const unshieldOutput = await unshieldStep.getValidStepOutput(
      firstStepInput,
    );
    const firstInternalStepInput = this.createNextStepInput(
      firstStepInput,
      unshieldOutput,
    );
    const internalSteps = await this.getInternalSteps(firstInternalStepInput);
    return skipShield
      ? [unshieldStep, ...internalSteps]
      : [unshieldStep, ...internalSteps, new ShieldStep()];
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
      erc20Amounts: input.erc20Amounts.map(erc20Amount => {
        return {
          tokenAddress: erc20Amount.tokenAddress,
          decimals: erc20Amount.decimals,
          isBaseToken: erc20Amount.isBaseToken,
          expectedBalance: erc20Amount.amount,
          minBalance: erc20Amount.amount,
          approvedSpender: undefined,
        };
      }),
      nfts: input.nfts,
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

  private static getNFTID(nft: RailgunNFTAmount) {
    return `${nft.nftAddress.toLowerCase()}-${nft.tokenSubID}-${
      nft.nftTokenType
    }`;
  }

  async getRecipeOutput(
    input: RecipeInput,
    skipUnshield = false,
    skipShield = false,
  ): Promise<RecipeOutput> {
    if (!this.supportsNetwork(input.networkName)) {
      throw new Error(
        `Recipe ${this.config.name} does not support network: ${input.networkName}.`,
      );
    }

    const firstStepInput = this.createFirstStepInput(input);
    const steps = await this.getFullSteps(
      firstStepInput,
      skipUnshield,
      skipShield,
    );

    const stepOutputs = await this.getStepOutputs(firstStepInput, steps);
    if (!stepOutputs.length) {
      throw new Error('No step outputs were generated.');
    }

    const populatedTransactions = stepOutputs
      .map(output => output.populatedTransactions)
      .flat();

    // We need to make sure to shield all step outputs, even those in the middle of recipes.
    const allStepOutputERC20Amounts: Record<string, RecipeERC20Amount> = {};
    stepOutputs.forEach((stepOutput, index) => {
      const isFinalStep = index === stepOutputs.length - 1;
      stepOutput.outputERC20Amounts.forEach(outputERC20Amount => {
        const tokenAddress = outputERC20Amount.tokenAddress.toLowerCase();
        if (allStepOutputERC20Amounts[tokenAddress] && isFinalStep) {
          // Only set amount for final step outputs.
          allStepOutputERC20Amounts[tokenAddress].amount =
            outputERC20Amount.expectedBalance;
          return;
        }
        allStepOutputERC20Amounts[tokenAddress] = {
          tokenAddress,
          decimals: outputERC20Amount.decimals,
          isBaseToken: outputERC20Amount.isBaseToken,
          // Expect 0 amount for middle step outputs.
          amount: isFinalStep
            ? outputERC20Amount.expectedBalance
            : BigNumber.from(0),
        };
      });
    });
    input.erc20Amounts.forEach(erc20Amount => {
      const tokenAddress = erc20Amount.tokenAddress.toLowerCase();
      if (allStepOutputERC20Amounts[tokenAddress]) {
        return;
      }
      allStepOutputERC20Amounts[tokenAddress] = {
        tokenAddress,
        decimals: erc20Amount.decimals,
        isBaseToken: erc20Amount.isBaseToken,
        // Expect 0 amount for unshield outputs.
        amount: BigNumber.from(0),
      };
    });

    // TODO: After callbacks upgrade, no need to batch-re-shield all tokens.
    // We will only need to re-shield output tokens, or step outputs with slippage.
    // Until then, we need all tokens to re-shield in case of revert.
    const shieldERC20Amounts: RecipeERC20Amount[] = Object.values(
      allStepOutputERC20Amounts,
    );

    // TODO: After callbacks upgrade, remove unshield NFTs to auto re-shield.
    const allStepOutputNFTAmounts: Record<string, RailgunNFTAmount> = {};
    stepOutputs.forEach((stepOutput, index) => {
      const isFinalStep = index === stepOutputs.length - 1;
      stepOutput.outputNFTs.forEach(outputNFT => {
        const nftID = Recipe.getNFTID(outputNFT);
        if (allStepOutputNFTAmounts[nftID] && isFinalStep) {
          // Only set amount for final step outputs.
          allStepOutputNFTAmounts[nftID].amountString = outputNFT.amountString;
          return;
        }
        allStepOutputNFTAmounts[nftID] = {
          ...outputNFT,
          amountString: isFinalStep ? outputNFT.amountString : '0x00',
        };
      });
    });
    input.nfts.forEach(nft => {
      const nftID = Recipe.getNFTID(nft);
      if (allStepOutputNFTAmounts[nftID]) {
        return;
      }
      allStepOutputNFTAmounts[nftID] = {
        ...nft,
        amountString: '0x00',
      };
    });
    const shieldNFTs: RailgunNFTAmount[] = Object.values(
      allStepOutputNFTAmounts,
    );

    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = stepOutputs
      .map(output => output.feeERC20AmountRecipients)
      .flat();

    const recipeOutput: RecipeOutput = {
      stepOutputs,
      populatedTransactions,
      erc20Amounts: shieldERC20Amounts,
      nfts: shieldNFTs,
      feeERC20AmountRecipients,
    };
    return recipeOutput;
  }
}
