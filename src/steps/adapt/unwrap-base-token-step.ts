import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { getWrappedBaseToken } from '../../utils/wrap-util';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import { compareERC20Info } from '../../utils/token';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';
import { ContractTransaction } from 'ethers';

export class UnwrapBaseTokenStep extends Step {
  readonly config: StepConfig = {
    name: 'Unwrap Base Token',
    description: 'Unwraps wrapped token into base token, ie WETH to ETH.',
  };

  private readonly amount: Optional<bigint>;

  /**
   * EIP-7702 relay-adapt host: the executing ephemeral EOA. The unwrap self-call
   * targets this account so it operates on that account's own balance rather
   * than the shared relay-adapt contract.
   */
  private readonly relayAdaptAddress: string;

  constructor(
    relayAdaptAddress: EphemeralExecutor | string,
    amount?: bigint,
  ) {
    super();
    this.relayAdaptAddress = resolveExecutorAddress(
      relayAdaptAddress,
      'UnwrapBaseTokenStep',
    );
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { networkName, erc20Amounts } = input;

    const wrappedBaseToken = getWrappedBaseToken(networkName);
    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, wrappedBaseToken),
        this.amount,
      );

    const contract = new RelayAdaptContract(this.relayAdaptAddress);
    const crossContractCalls: ContractTransaction[] = [
      await contract.createBaseTokenUnwrap(this.amount),
    ];

    const unwrappedBaseERC20Amount: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      isBaseToken: true,
      expectedBalance: this.amount ?? erc20AmountForStep.expectedBalance,
      minBalance: this.amount ?? erc20AmountForStep.minBalance,
    };
    const spentWrappedERC20Amount: RecipeERC20AmountRecipient = {
      ...wrappedBaseToken,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: 'Wrapped Token Contract',
    };

    return {
      crossContractCalls,
      spentERC20Amounts: [spentWrappedERC20Amount],
      outputERC20Amounts: [unwrappedBaseERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
