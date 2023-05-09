import { BigNumber } from '@ethersproject/bignumber';
import {
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { Step } from '../../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { ERC20Contract } from '../../../contract/token/erc20-contract';
import { compareERC20Info } from '../../../utils/token';
import { createNoActionStepOutput } from '../../../utils/no-action-output';

export class ApproveERC20SpenderStep extends Step {
  readonly config = {
    name: 'Approve ERC20 Spender',
    description: 'Approves ERC20 for spender contract.',
  };

  private readonly spender: Optional<string>;
  private readonly tokenInfo: RecipeERC20Info;
  private readonly amount: Optional<BigNumber>;

  constructor(
    spender: Optional<string>,
    tokenInfo: RecipeERC20Info,
    amount?: BigNumber,
  ) {
    super();
    this.spender = spender;
    this.tokenInfo = tokenInfo;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    if (!this.spender || this.tokenInfo.isBaseToken) {
      return createNoActionStepOutput(input);
    }

    const { erc20Amounts } = input;

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, this.tokenInfo) &&
          erc20Amount.approvedSpender !== this.spender,
        this.amount,
      );

    const contract = new ERC20Contract(erc20AmountForStep.tokenAddress);
    const approveAmount = this.amount ?? erc20AmountForStep.expectedBalance;

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createSpenderApproval(this.spender, approveAmount),
    ];
    const approvedERC20Amount: StepOutputERC20Amount = {
      tokenAddress: erc20AmountForStep.tokenAddress,
      decimals: erc20AmountForStep.decimals,
      isBaseToken: erc20AmountForStep.isBaseToken,
      expectedBalance: approveAmount,
      minBalance: approveAmount,
      approvedSpender: this.spender,
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
