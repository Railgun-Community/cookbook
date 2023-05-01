import { BigNumber } from '@ethersproject/bignumber';
import {
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { ERC20Contract } from '../../contract/token/erc20-contract';

export class ApproveERC20SpenderStep extends Step {
  readonly name = 'Approve ERC20';
  readonly description = 'Approves ERC20 for spender contract.';

  private readonly spender: string;
  private readonly amount: BigNumber;

  constructor(spender: string, amount: BigNumber) {
    super();

    this.spender = spender;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;

    const { erc20AmountForStep, unusedERC20Amounts } =
      filterSingleERC20AmountInput(
        erc20Amounts,
        erc20Amount =>
          !erc20Amount.isBaseToken &&
          erc20Amount.approvedForSpender !== this.spender,
      );

    const contract = new ERC20Contract(erc20AmountForStep.tokenAddress);

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createSpenderApproval(this.spender, this.amount),
    ];
    const approvedERC20Amount: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      approvedForSpender: this.spender,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [],
      outputERC20Amounts: [approvedERC20Amount, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
