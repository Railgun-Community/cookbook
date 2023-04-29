import { StepOutputERC20Amount } from '../models/export-models';

type ERC20AmountFilter = (erc20Amount: StepOutputERC20Amount) => boolean;

export const filterERC20AmountInputs = (
  inputERC20Amounts: StepOutputERC20Amount[],
  filter: ERC20AmountFilter,
): {
  erc20AmountsForStep: StepOutputERC20Amount[];
  unusedERC20Amounts: StepOutputERC20Amount[];
} => {
  const erc20AmountsForStep = inputERC20Amounts.filter(filter);
  const unusedERC20Amounts = inputERC20Amounts.filter(
    erc20Amount => !filter(erc20Amount),
  );
  return { erc20AmountsForStep, unusedERC20Amounts };
};

export const filterSingleERC20AmountInput = (
  inputERC20Amounts: StepOutputERC20Amount[],
  filter: ERC20AmountFilter,
): {
  erc20AmountForStep: StepOutputERC20Amount;
  unusedERC20Amounts: StepOutputERC20Amount[];
} => {
  const { erc20AmountsForStep, unusedERC20Amounts } = filterERC20AmountInputs(
    inputERC20Amounts,
    filter,
  );

  const numFiltered = erc20AmountsForStep.length;
  if (numFiltered !== 1) {
    throw new Error(
      `Expected one erc20 amount after filterSingleERC20AmountInput - received ${numFiltered}.`,
    );
  }
  return { erc20AmountForStep: erc20AmountsForStep[0], unusedERC20Amounts };
};
