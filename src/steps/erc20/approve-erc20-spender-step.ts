import { BigNumber } from '@ethersproject/bignumber';
import {
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import { compareERC20Info } from '../../utils/token';
import { createNoActionStepOutput } from '../default/no-action-output';

export class ApproveERC20SpenderStep extends Step {
  readonly name = 'Approve ERC20';
  readonly description = 'Approves ERC20 for spender contract.';

  private readonly spender: Optional<string>;
  private readonly tokenAddress: string;
  private readonly amount: Optional<BigNumber>;

  constructor(
    spender: Optional<string>,
    tokenAddress: string,
    amount?: BigNumber,
  ) {
    super();
    this.spender = spender;
    this.tokenAddress = tokenAddress;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    if (!this.spender) {
      return createNoActionStepOutput(input);
    }

    const { erc20Amounts } = input;

    const erc20ForApproval: RecipeERC20Info = {
      tokenAddress: this.tokenAddress,
      isBaseToken: false,
    };

    const { erc20AmountForStep, unusedERC20Amounts } =
      filterSingleERC20AmountInput(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, erc20ForApproval) &&
          erc20Amount.approvedForSpender !== this.spender,
      );

    const contract = new ERC20Contract(erc20AmountForStep.tokenAddress);
    const approveAmount = this.amount ?? erc20AmountForStep.minBalance;

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createSpenderApproval(this.spender, approveAmount),
    ];
    const approvedERC20Amount: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      expectedBalance: approveAmount,
      minBalance: approveAmount,
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
