import { StepInput, UnvalidatedStepOutput } from '../../models/export-models';

export const createNoActionStepOutput = (
  input: StepInput,
): UnvalidatedStepOutput => {
  return {
    populatedTransactions: [],
    spentERC20Amounts: [],
    outputERC20Amounts: input.erc20Amounts,
    spentNFTs: [],
    outputNFTs: input.nfts,
    feeERC20AmountRecipients: [],
  };
};
