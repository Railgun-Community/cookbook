import { BigNumber } from '@ethersproject/bignumber';
import {
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import { getBaseToken } from './wrap-util';
import { compareERC20Info } from '../../utils/token';

export class WrapBaseTokenStep extends Step {
  readonly name = 'Wrap Base Token';
  readonly description = 'Wraps base token into wrapped token, ie ETH to WETH.';

  private readonly amount: Optional<BigNumber>;

  constructor(amount?: BigNumber) {
    super();
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { networkName, erc20Amounts } = input;

    const baseToken = getBaseToken(networkName);
    const { erc20AmountForStep, unusedERC20Amounts } =
      filterSingleERC20AmountInput(erc20Amounts, erc20Amount =>
        compareERC20Info(erc20Amount, baseToken),
      );

    const contract = new RelayAdaptContract(input.networkName);

    // TODO: Calculate additional output (for unused array).
    const wrapAmount = this.amount ?? erc20AmountForStep.minBalance;

    const populatedTransactions: PopulatedTransaction[] = [
      await contract.createBaseTokenWrap(wrapAmount),
    ];
    const wrappedBaseToken: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      isBaseToken: false,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [],
      outputERC20Amounts: [wrappedBaseToken, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
