import {
  NetworkName,
  RailgunNFTAmount,
  isDefined,
} from '@railgun-community/shared-models';
import {
  RecipeConfig,
  RecipeERC20AmountRecipient,
  RecipeInput,
  RecipeNFTRecipient,
  RecipeOutput,
  RecipePositionInfo,
  StepInput,
  StepOutput,
} from '../models/export-models';
import { ShieldDefaultStep } from '../steps/railgun/shield-default-step';
import { UnshieldDefaultStep } from '../steps/railgun/unshield-default-step';
import { Step } from '../steps/step';
import { ContractTransaction } from 'ethers';
import { generateID } from '../utils/id';
// Direct module import (not the utils barrel) to keep madge --circular clean.
import { nftIdentityKey } from '../utils/nft';

export abstract class Recipe {
  readonly id: string;

  abstract readonly config: RecipeConfig;

  constructor() {
    this.id = generateID();
  }

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
      return skipShield
        ? internalSteps
        : [...internalSteps, new ShieldDefaultStep()];
    }
    const unshieldStep = new UnshieldDefaultStep();
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
      : [unshieldStep, ...internalSteps, new ShieldDefaultStep()];
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
    // Delegates to the shared identity key so this, the step validator, and the
    // combo-meal seam all agree on what "the same NFT" means — notably across
    // tokenSubID zero-padding.
    return nftIdentityKey(nft);
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

    const { railgunAddress } = input;

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

    const crossContractCalls: ContractTransaction[] = stepOutputs
      .map(output => output.crossContractCalls)
      .flat();

    // TODO: Pre callbacks, we need to make sure to shield all step outputs,
    // even those in the middle of recipes and those with 0n expected amounts.
    const allStepOutputERC20AmountRecipients: Record<
      string,
      RecipeERC20AmountRecipient
    > = {};
    stepOutputs.forEach((stepOutput, index) => {
      const isFinalStep = index === stepOutputs.length - 1;
      stepOutput.outputERC20Amounts.forEach(outputERC20Amount => {
        const tokenAddress = outputERC20Amount.tokenAddress.toLowerCase();
        if (
          isDefined(allStepOutputERC20AmountRecipients[tokenAddress]) &&
          isFinalStep
        ) {
          // Only set amount for final step outputs.
          allStepOutputERC20AmountRecipients[tokenAddress].amount =
            outputERC20Amount.expectedBalance;
          // Carry the worst-case balance for conservative combo seams.
          allStepOutputERC20AmountRecipients[tokenAddress].minBalance =
            outputERC20Amount.minBalance;
          return;
        }
        allStepOutputERC20AmountRecipients[tokenAddress] = {
          tokenAddress,
          decimals: outputERC20Amount.decimals,
          isBaseToken: outputERC20Amount.isBaseToken,
          // Expect 0 amount for middle step outputs.
          amount: isFinalStep ? outputERC20Amount.expectedBalance : 0n,
          minBalance: isFinalStep ? outputERC20Amount.minBalance : 0n,
          recipient: outputERC20Amount.recipient ?? railgunAddress,
        };
      });
    });

    // Map all unhandled ERC20 inputs into recipe outputs.
    input.erc20Amounts.forEach(erc20Amount => {
      const tokenAddress = erc20Amount.tokenAddress.toLowerCase();
      if (isDefined(allStepOutputERC20AmountRecipients[tokenAddress])) {
        return;
      }
      allStepOutputERC20AmountRecipients[tokenAddress] = {
        tokenAddress,
        decimals: erc20Amount.decimals,
        isBaseToken: erc20Amount.isBaseToken,
        // Expect 0 amount for unshield outputs.
        amount: 0n,
        minBalance: 0n,
        recipient: erc20Amount.recipient ?? railgunAddress,
      };
    });

    // TODO: After callbacks upgrade, no need to batch-re-shield all tokens.
    // We will only need to re-shield output tokens, or step outputs with slippage.
    // Until then, we need all tokens to re-shield in case of revert.
    const outputERC20AmountRecipients: RecipeERC20AmountRecipient[] =
      Object.values(allStepOutputERC20AmountRecipients);

    // TODO: Remove 0n amounts after callbacks.
    // .filter(({ amount }) => amount > 0n);

    // TODO: After callbacks upgrade, remove unshield NFTs to auto re-shield.
    const allStepOutputNFTAmountRecipients: Record<string, RecipeNFTRecipient> =
      {};
    stepOutputs.forEach((stepOutput, index) => {
      const isFinalStep = index === stepOutputs.length - 1;
      stepOutput.outputNFTs.forEach(outputNFT => {
        const nftID = Recipe.getNFTID(outputNFT);
        if (isDefined(allStepOutputNFTAmountRecipients[nftID]) && isFinalStep) {
          // Only set amount for final step outputs.
          allStepOutputNFTAmountRecipients[nftID].amount = outputNFT.amount;
          return;
        }
        allStepOutputNFTAmountRecipients[nftID] = {
          ...outputNFT,
          amount: isFinalStep ? outputNFT.amount : 0n,
          recipient: outputNFT.recipient ?? railgunAddress,
        };
      });
    });

    // Map all unhandled NFT inputs into recipe outputs.
    input.nfts.forEach(nft => {
      const nftID = Recipe.getNFTID(nft);
      if (isDefined(allStepOutputNFTAmountRecipients[nftID])) {
        return;
      }
      allStepOutputNFTAmountRecipients[nftID] = {
        ...nft,
        amount: 0n,
        recipient: nft.recipient ?? railgunAddress,
      };
    });

    const outputNFTRecipients: RecipeNFTRecipient[] = Object.values(
      allStepOutputNFTAmountRecipients,
    );

    // TODO: Remove 0n amounts after callbacks.
    // .filter(({ amount }) => amount > 0n);

    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = stepOutputs
      .map(
        output =>
          output.feeERC20AmountRecipients?.filter(feeERC20AmountRecipient => {
            // Only return fees with non-zero amounts.
            return feeERC20AmountRecipient.amount > 0n;
          }) ?? [],
      )
      .flat();

    // Positions are events, not balances, so they concatenate rather than
    // dedupe.
    //
    // The ERC20 and NFT branches above key-and-collapse because every step
    // re-declares its inputs as outputs, so one artifact appears once per step
    // and only the final step's figure is the terminal state. A position record
    // is emitted only by the step that actually changes the position, and no
    // later step re-declares it. Two records for the same market and leg
    // therefore mean two real changes, and collapsing them would drop one.
    //
    // Concatenating also preserves per-step provenance, which is what a
    // consumer renders: "supplied X collateral, then borrowed Y" rather than a
    // single netted figure whose two halves are no longer visible.
    //
    // Not filtered on `amount > 0n` the way fees are: a shares-denominated
    // repay carries its exact magnitude in `shares`, so a record can carry a
    // zero or estimated `amount` and still describe a real change.
    const outputPositions: RecipePositionInfo[] = stepOutputs
      .map(output => output.outputPositions ?? [])
      .flat();

    const recipeOutput: RecipeOutput = {
      name: this.config.name,
      stepOutputs,
      crossContractCalls,
      erc20AmountRecipients: outputERC20AmountRecipients,
      nftRecipients: outputNFTRecipients,
      feeERC20AmountRecipients,
      outputPositions,
      minGasLimit: this.config.minGasLimit,
    };
    return recipeOutput;
  }
}
