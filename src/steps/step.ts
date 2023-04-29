import { BigNumber } from '@ethersproject/bignumber';
import {
  StepInput,
  StepOutput,
  UnvalidatedStepOutput,
} from '../models/export-models';

export abstract class Step {
  abstract readonly name: string;
  abstract readonly description: string;

  readonly canAddStep: boolean = true;

  protected abstract getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput>;

  async getValidStepOutput(input: StepInput): Promise<StepOutput> {
    try {
      const output: UnvalidatedStepOutput = await this.getStepOutput(input);
      this.validateStepOutput(input, output);

      return {
        ...output,
        name: this.name,
        description: this.description,
      };
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(`Step ${this.name} failed: ${err.message}`);
    }
  }

  private validateStepOutput(input: StepInput, output: UnvalidatedStepOutput) {
    const inputERC20AmountMap: Record<string, BigNumber> = {};
    const outputERC20AmountMap: Record<string, BigNumber> = {};

    // Add all erc20 inputs.
    input.erc20Amounts.forEach(({ tokenAddress, expectedBalance }) => {
      inputERC20AmountMap[tokenAddress] ??= BigNumber.from(0);
      inputERC20AmountMap[tokenAddress] =
        inputERC20AmountMap[tokenAddress].add(expectedBalance);
    });

    // Add all erc20 outputs.
    output.outputERC20Amounts.forEach(
      ({ tokenAddress, expectedBalance, minBalance }) => {
        outputERC20AmountMap[tokenAddress] ??= BigNumber.from(0);
        outputERC20AmountMap[tokenAddress] =
          outputERC20AmountMap[tokenAddress].add(expectedBalance);
        if (expectedBalance.lt(minBalance)) {
          throw new Error('Min balance must be >= expected balance.');
        }
      },
    );
    output.spentERC20Amounts.forEach(({ tokenAddress, amount }) => {
      outputERC20AmountMap[tokenAddress] ??= BigNumber.from(0);
      outputERC20AmountMap[tokenAddress] =
        outputERC20AmountMap[tokenAddress].add(amount);
    });
    output.feeERC20AmountRecipients.forEach(({ tokenAddress, amount }) => {
      outputERC20AmountMap[tokenAddress] ??= BigNumber.from(0);
      outputERC20AmountMap[tokenAddress] =
        outputERC20AmountMap[tokenAddress].add(amount);
    });

    for (const tokenAddress in inputERC20AmountMap) {
      if (
        !inputERC20AmountMap[tokenAddress].eq(
          outputERC20AmountMap[tokenAddress],
        )
      ) {
        throw new Error(
          `Validation Error: Input ERC20 amounts for ${tokenAddress} do not map to total outputs/spent/fees.`,
        );
      }
    }

    // TODO: Validate NFT inputs and outputs.  No duplicates in outputs array. Every input mapped to an output.
  }
}
