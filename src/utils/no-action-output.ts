import { StepInput, UnvalidatedStepOutput } from '../models/export-models';

export const createNoActionStepOutput = (
  input: StepInput,
): UnvalidatedStepOutput => {
  return {
    crossContractCalls: [],

    outputERC20Amounts: input.erc20Amounts,

    outputNFTs: input.nfts,
  };
};
