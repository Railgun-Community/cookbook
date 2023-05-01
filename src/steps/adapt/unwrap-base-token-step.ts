import { BigNumber } from '@ethersproject/bignumber';
import {
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { Step } from '../step';
import { getWrappedBaseToken } from './wrap-util';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import { compareERC20Info } from '../../utils/token';

export class UnwrapBaseTokenStep extends Step {
  readonly name = 'Unwrap Base Token';
  readonly description =
    'Unwraps wrapped token into base token, ie WETH to ETH.';

  private readonly amount: Optional<BigNumber>;

  constructor(amount?: BigNumber) {
    super();
    this.amount = amount;
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

    // TODO: Calculate additional output (for unused array).
    const unwrapAmount = this.amount ?? erc20AmountForStep.minBalance;

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createBaseTokenUnwrap(unwrapAmount),
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
