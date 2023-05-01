import { BigNumber } from 'ethers';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import {
  RecipeERC20AmountRecipient,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { getBaseToken } from './wrap-util';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class TransferBaseTokenStep extends Step {
  readonly config = {
    name: 'Transfer Base Token',
    description: 'Transfers base token to an external public address.',
  };

  private readonly toAddress: string;

  private readonly amount: Optional<BigNumber>;

  constructor(toAddress: string, amount?: BigNumber) {
    super();
    this.toAddress = toAddress;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { networkName, erc20Amounts } = input;

    const baseToken = getBaseToken(networkName);

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, baseToken),
        this.amount,
      );

    const contract = new RelayAdaptContract(input.networkName);

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createBaseTokenTransfer(this.toAddress, this.amount),
    ];

    const transferredBaseToken: RecipeERC20AmountRecipient = {
      ...baseToken,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: this.toAddress,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [transferredBaseToken],
      outputERC20Amounts: unusedERC20Amounts,
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
