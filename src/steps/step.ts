import { isDefined } from '@railgun-community/shared-models';
import {
  StepInput,
  StepOutput,
  StepConfig,
  UnvalidatedStepOutput,
  StepOutputERC20Amount,
  RecipeNFTInfo,
} from '../models/export-models';
import {
  ERC20AmountFilter,
  NFTAmountFilter,
  filterERC20AmountInputs,
  filterNFTAmountInputs,
} from '../utils/filters';
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
      throw new Error(`${this.config.name} step is invalid. ${err.message}`);
    }
  }

  protected getValidInputERC20Amount(
    inputERC20Amounts: StepOutputERC20Amount[],
    filter: ERC20AmountFilter,
    amount: Optional<bigint>,
  ): {
    erc20AmountForStep: StepOutputERC20Amount;
    unusedERC20Amounts: StepOutputERC20Amount[];
  } {
    const { erc20AmountsForStep, unusedERC20Amounts } = filterERC20AmountInputs(
      inputERC20Amounts,
      filter,
    );

    const numFiltered = erc20AmountsForStep.length;
    if (numFiltered === 0) {
      throw new Error(`No step inputs match filter.`);
    }
    if (numFiltered > 1) {
      throw new Error(
        `Expected one erc20 amount for step input - received ${numFiltered}.`,
      );
    }

    // Copy values to new object.
    const erc20AmountForStep = { ...erc20AmountsForStep[0] };

    const hasNonDeterministicInput =
      erc20AmountForStep.expectedBalance !== erc20AmountForStep.minBalance;

    // If this step has a non-deterministic output, we must provide deterministic inputs.
    // Otherwise, the expected balances become too complicated and variable.
    if (
      (this.config.hasNonDeterministicOutput ?? false) &&
      hasNonDeterministicInput
    ) {
      throw new Error(
        `Non-deterministic step must have deterministic inputs - you may not stack non-deterministic steps in a single recipe.`,
      );
    }

    if (isDefined(amount)) {
      // If we have a specified amount, we must have a deterministic input in order to generate the change outputs.
      if (hasNonDeterministicInput) {
        throw new Error(
          'Cannot specify amount for step if it has non-deterministic inputs.',
        );
      }
      // Note: minBalance === expectedBalance
      if (amount > erc20AmountForStep.expectedBalance) {
        throw new Error(
          `Specified amount ${amount} exceeds balance ${erc20AmountForStep.expectedBalance}.`,
        );
      }
    }

    // Add change output.
    const changeOutputs = this.getChangeOutputs(erc20AmountForStep, amount);
    if (changeOutputs) {
      unusedERC20Amounts.push(changeOutputs.changeOutput);
      erc20AmountForStep.expectedBalance = changeOutputs.expectedBalance;
      erc20AmountForStep.minBalance = changeOutputs.minBalance;
    }

    return { erc20AmountForStep, unusedERC20Amounts };
  }

  protected getValidInputNFTAmount(
    inputNFTAmounts: RecipeNFTInfo[],
    filter: NFTAmountFilter,
  ): {
    nftAmountForStep: RecipeNFTInfo;
    unusedNFTAmounts: RecipeNFTInfo[];
  } {
    const { nftAmountsForStep, unusedNFTAmounts } = filterNFTAmountInputs(
      inputNFTAmounts,
      filter,
    );

    const numFiltered = nftAmountsForStep.length;
    if (numFiltered === 0) {
      throw new Error(`No step inputs match filter.`);
    }
    if (numFiltered > 1) {
      throw new Error(
        `Expected one NFT amount for step input - received ${numFiltered}.`,
      );
    }

    // Copy values to new object.
    const nftAmountForStep = { ...nftAmountsForStep[0] };

    return { nftAmountForStep, unusedNFTAmounts };
  }

  private getChangeOutputs(
    erc20AmountForStep: StepOutputERC20Amount,
    amountUsed: Optional<bigint>,
  ) {
    if (
      !isDefined(amountUsed) ||
      amountUsed >= erc20AmountForStep.expectedBalance
    ) {
      return undefined;
    }

    const changeBalance = erc20AmountForStep.expectedBalance - amountUsed;
    const changeOutput: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      expectedBalance: changeBalance,
      minBalance: changeBalance,
    };
    return {
      expectedBalance: amountUsed,
      minBalance: amountUsed,
      changeOutput,
    };
  }

  protected getValidInputERC20Amounts(
    inputERC20Amounts: StepOutputERC20Amount[],
    filters: ERC20AmountFilter[],
    amountsPerAddress: Record<string, bigint>,
  ): {
    erc20AmountsForStep: StepOutputERC20Amount[];
    unusedERC20Amounts: StepOutputERC20Amount[];
  } {
    const anyFilterPasses = (erc20Amount: StepOutputERC20Amount) => {
      return (
        filters.find(filter => {
          return filter(erc20Amount);
        }) != null
      );
    };

    const { erc20AmountsForStep, unusedERC20Amounts } = filterERC20AmountInputs(
      inputERC20Amounts,
      anyFilterPasses,
    );

    const numFiltered = erc20AmountsForStep.length;
    if (numFiltered !== filters.length) {
      throw new Error(
        `Step input does not include a balance for each filtered token.`,
      );
    }

    // Add change outputs.
    erc20AmountsForStep.forEach(erc20AmountForStep => {
      const amount = amountsPerAddress[erc20AmountForStep.tokenAddress];
      if (!amount) {
        return;
      }
      const changeOutputs = this.getChangeOutputs(erc20AmountForStep, amount);
      if (changeOutputs) {
        unusedERC20Amounts.push(changeOutputs.changeOutput);
        erc20AmountForStep.expectedBalance = changeOutputs.expectedBalance;
        erc20AmountForStep.minBalance = changeOutputs.minBalance;
      }
    });

    return { erc20AmountsForStep, unusedERC20Amounts };
  }
}
