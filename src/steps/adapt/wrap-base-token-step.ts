import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import { getBaseToken } from '../../utils/wrap-util';
import { compareERC20Info } from '../../utils/token';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';
import { ContractTransaction } from 'ethers';

/**
 * **Failure semantics (7702).** `wrapBase(0)` wraps the executor's ENTIRE ETH
 * balance. If the call fails the ETH stays native, and native ETH is the one
 * asset the shield epilogue cannot sweep (`shield` handles ERC-20/ERC-721 only),
 * so it strands publicly at the ephemeral EOA. Wrapping is what makes base-token
 * value recoverable at all. See `steps/failure-modes.ts`.
 */
export class WrapBaseTokenStep extends Step {
  readonly config: StepConfig = {
    name: 'Wrap Base Token',
    description: 'Wraps base token into wrapped token, ie ETH to WETH.',
  };

  private readonly amount: Optional<bigint>;

  /**
   * EIP-7702 relay-adapt host: the executing ephemeral EOA. The wrap self-call
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
      'WrapBaseTokenStep',
    );
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

    const contract = new RelayAdaptContract(this.relayAdaptAddress);
    const crossContractCalls: ContractTransaction[] = [
      await contract.createBaseTokenWrap(this.amount),
    ];

    const wrappedBaseERC20Amount: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      isBaseToken: false,
      expectedBalance: this.amount ?? erc20AmountForStep.expectedBalance,
      minBalance: this.amount ?? erc20AmountForStep.minBalance,
    };
    const spentBaseERC20Amount: RecipeERC20AmountRecipient = {
      ...baseToken,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: 'Wrapped Token Contract',
    };

    return {
      crossContractCalls,
      spentERC20Amounts: [spentBaseERC20Amount],
      outputERC20Amounts: [wrappedBaseERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
