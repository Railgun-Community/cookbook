import { BigNumber } from 'ethers';
import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { ERC20Contract } from '../../contract/token/erc20-contract';

export class TransferERC20Step extends Step {
  readonly config = {
    name: 'Transfer ERC20',
    description: 'Transfers ERC20 token to an external public address.',
  };

  private readonly toAddress: string;

  private readonly tokenAddress: string;

  private readonly amount: Optional<BigNumber>;

  constructor(toAddress: string, tokenAddress: string, amount?: BigNumber) {
    super();
    this.toAddress = toAddress;
    this.tokenAddress = tokenAddress;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;

    const erc20Info: RecipeERC20Info = {
      tokenAddress: this.tokenAddress,
      isBaseToken: false,
    };

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, erc20Info),
        this.amount,
      );

    const contract = new ERC20Contract(this.tokenAddress);

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createTransfer(
        this.toAddress,
        this.amount ?? erc20AmountForStep.expectedBalance,
      ),
    ];

    const transferredERC20: RecipeERC20AmountRecipient = {
      ...erc20Info,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: this.toAddress,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [transferredERC20],
      outputERC20Amounts: unusedERC20Amounts,
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
