import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';
import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { getBaseToken } from '../../utils/wrap-util';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';
import { ContractTransaction } from 'ethers';

/**
 * **Failure semantics (7702).** On failure the ETH stays native at the executor
 * and is not sweepable by the shield epilogue. On success it has left the batch
 * for an external address and nothing later can pull it back. The base-token
 * branch of `RelayAdapt7702.transfer` is a raw `.call` guarded by
 * `require(success, "RelayAdapt: ETH transfer failed")`, so a recipient that
 * rejects ETH fails the whole `transfer` call rather than just its own entry.
 */
export class TransferBaseTokenStep extends Step {
  readonly config: StepConfig = {
    name: 'Transfer Base Token',
    description: 'Transfers base token to an external public address.',
  };

  private readonly toAddress: string;
  private readonly amount: Optional<bigint>;

  /**
   * EIP-7702 relay-adapt host: the executing ephemeral EOA that holds the base
   * token being transferred. The transfer self-call targets this account (not
   * the shared relay-adapt contract); `toAddress` is the external destination.
   */
  private readonly relayAdaptAddress: string;

  constructor(
    toAddress: string,
    relayAdaptAddress: EphemeralExecutor | string,
    amount?: bigint,
  ) {
    super();
    this.toAddress = toAddress;
    this.relayAdaptAddress = resolveExecutorAddress(
      relayAdaptAddress,
      'TransferBaseTokenStep',
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
      await contract.createBaseTokenTransfer(this.toAddress, this.amount),
    ];

    const transferredBaseToken: RecipeERC20AmountRecipient = {
      ...baseToken,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: this.toAddress,
    };

    return {
      crossContractCalls,
      spentERC20Amounts: [transferredBaseToken],
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
