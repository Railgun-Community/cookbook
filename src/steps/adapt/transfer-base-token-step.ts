import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import {
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { getWrappedBaseToken } from './wrap-util';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class TransferBaseTokenStep extends Step {
  readonly name = 'Transfer Base Token';
  readonly description = 'Transfers base token to an external public address.';

  private readonly toAddress: string;

  constructor(toAddress: string) {
    super();
    this.toAddress = toAddress;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { networkName, erc20Amounts } = input;

    const wrappedBaseToken = getWrappedBaseToken(networkName);

    const { erc20AmountForStep, unusedERC20Amounts } =
      filterSingleERC20AmountInput(erc20Amounts, erc20Amount =>
        compareERC20Info(erc20Amount, wrappedBaseToken),
      );

    const contract = new RelayAdaptContract(input.networkName);

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createBaseTokenTransfer(this.toAddress),
    ];
    const unwrappedBaseToken: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      isBaseToken: true,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [],
      outputERC20Amounts: [unwrappedBaseToken, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
