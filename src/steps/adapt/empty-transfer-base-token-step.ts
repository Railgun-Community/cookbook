import { BigNumber } from 'ethers';
import { StepInput, UnvalidatedStepOutput } from '../../models/export-models';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { ZERO_ADDRESS } from '../../models/constants';

export class EmptyTransferBaseTokenStep extends Step {
  readonly config = {
    name: 'Empty Transfer Base Token',
    description:
      'Used for testing. Sends a 0-token transfer to a null address.',
  };

  private readonly toAddress = ZERO_ADDRESS;
  private readonly amount = BigNumber.from(0);

  constructor() {
    super();
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;
    const unusedERC20Amounts = erc20Amounts;

    const populatedTransactions: PopulatedTransaction[] = [
      {
        to: this.toAddress,
        value: this.amount,
      },
    ];

    return {
      populatedTransactions,
      spentERC20Amounts: [],
      outputERC20Amounts: unusedERC20Amounts,
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
