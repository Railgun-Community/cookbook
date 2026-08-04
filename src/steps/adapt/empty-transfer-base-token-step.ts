import {
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { ZERO_ADDRESS } from '../../models/constants';
import { ContractTransaction } from 'ethers';

/**
 * **Failure semantics (7702).** Cannot fail — a 0-value, 0-data call to the zero
 * address always succeeds (codeless account). Leaves no residue.
 */
export class EmptyTransferBaseTokenStep extends Step {
  readonly config: StepConfig = {
    name: 'Empty Transfer Base Token',
    description:
      'Used for testing. Sends a 0-token transfer to a null address.',
  };

  private readonly toAddress = ZERO_ADDRESS;
  private readonly amount = 0n;

  constructor() {
    super();
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;
    const unusedERC20Amounts = erc20Amounts;

    const crossContractCalls: ContractTransaction[] = [
      {
        data: '0x',
        to: this.toAddress,
        value: this.amount,
      },
    ];

    return {
      crossContractCalls,
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
