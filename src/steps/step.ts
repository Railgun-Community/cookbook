import { BigNumber } from '@ethersproject/bignumber';
import {
  StepInput,
  StepOutput,
  StepConfig,
  UnvalidatedStepOutput,
  StepOutputERC20Amount,
} from '../models/export-models';
import { ERC20AmountFilter, filterERC20AmountInputs } from '../utils/filters';
import { validateStepOutput } from '../validators/step-validator';

export abstract class Step {
  abstract readonly config: StepConfig;

  readonly canAddStep: boolean = true;

  protected abstract getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput>;

  async getValidStepOutput(input: StepInput): Promise<StepOutput> {
    try {
      const output: UnvalidatedStepOutput = await this.getStepOutput(input);
      validateStepOutput(input, output);

      return {
        ...output,
        name: this.config.name,
        description: this.config.description,
      };
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(`Step ${this.config.name} failed: ${err.message}`);
    }
  }

  getValidInputERC20Amount(
    inputERC20Amounts: StepOutputERC20Amount[],
    filter: ERC20AmountFilter,
    amount?: BigNumber,
  ): {
    erc20AmountForStep: StepOutputERC20Amount;
    unusedERC20Amounts: StepOutputERC20Amount[];
  } {
    const { erc20AmountsForStep, unusedERC20Amounts } = filterERC20AmountInputs(
      inputERC20Amounts,
      filter,
    );

    const numFiltered = erc20AmountsForStep.length;
    if (numFiltered !== 1) {
      throw new Error(
        `Expected one erc20 amount for step input - received ${numFiltered}.`,
      );
    }

    const erc20AmountForStep = erc20AmountsForStep[0];

    const hasNonDeterministicInput = !erc20AmountForStep.expectedBalance.eq(
      erc20AmountForStep.minBalance,
    );

    // If this step has a non-deterministic output, we must provide deterministic inputs.
    // Otherwise, the expected balances become too complicated and variable.
    if (this.config.hasNonDeterministicOutput && hasNonDeterministicInput) {
      throw new Error(
        `Non-deterministic step must have deterministic inputs - you may not stack non-deterministic steps in a single recipe.`,
      );
    }

    if (amount) {
      // If we have a specified amount, we must have a deterministic input in order to generate the change outputs.
      if (hasNonDeterministicInput) {
        throw new Error(
          'Cannot specify amount for step if it has non-deterministic inputs.',
        );
      }
      // Note: minBalance === expectedBalance
      if (amount.gt(erc20AmountForStep.expectedBalance)) {
        throw new Error(
          `Specified amount ${amount.toString()} exceeds expected/minimum balance ${erc20AmountForStep.expectedBalance.toString()}.`,
        );
      }
    }

    // Add change output.
    if (amount?.lt(erc20AmountForStep.expectedBalance)) {
      const changeBalance = erc20AmountForStep.expectedBalance.sub(amount);
      unusedERC20Amounts.push({
        ...erc20AmountForStep,
        expectedBalance: changeBalance,
        minBalance: changeBalance,
      });
      erc20AmountForStep.expectedBalance = amount;
      erc20AmountForStep.minBalance = amount;
    }

    return { erc20AmountForStep, unusedERC20Amounts };
  }
}
