import { StepOutputERC20Amount } from '../models/export-models';

export type ERC20AmountFilter = (erc20Amount: StepOutputERC20Amount) => boolean;

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
