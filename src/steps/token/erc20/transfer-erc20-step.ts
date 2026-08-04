import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info } from '../../../utils/token';
import { Step } from '../../step';
import { ContractTransaction } from 'ethers';
import { RelayAdaptContract } from '../../../contract';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../../utils/7702';

/**
 * **Failure semantics (7702).** On failure the token is untouched at the executor
 * and the shield epilogue sweeps it back. On success it is gone to an external
 * address: the only ERC-20 step whose success a later failure cannot undo, so it
 * belongs last among the value-moving steps. An unspecified `amount` encodes
 * `value: 0`, which sends the ENTIRE balance.
 */
export class TransferERC20Step extends Step {
  readonly config: StepConfig = {
    name: 'Transfer ERC20',
    description: 'Transfers ERC20 token to an external public address.',
  };

  private readonly toAddress: string;

  private readonly erc20Info: RecipeERC20Info;

  private readonly amount: Optional<bigint>;

  /**
   * EIP-7702 relay-adapt host: the executing ephemeral EOA that holds the token
   * being transferred. The transfer self-call targets this account (not the
   * shared relay-adapt contract); `toAddress` is the external destination.
   */
  private readonly relayAdaptAddress: string;

  constructor(
    toAddress: string,
    erc20Info: RecipeERC20Info,
    relayAdaptAddress: EphemeralExecutor | string,
    amount?: bigint,
  ) {
    super();
    this.toAddress = toAddress;
    this.erc20Info = erc20Info;
    this.relayAdaptAddress = resolveExecutorAddress(
      relayAdaptAddress,
      'TransferERC20Step',
    );
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, this.erc20Info),
        this.amount,
      );

    const contract = new RelayAdaptContract(this.relayAdaptAddress);
    const crossContractCalls: ContractTransaction[] = [
      await contract.createERC20Transfer(
        this.toAddress,
        this.erc20Info.tokenAddress,
        this.amount,
      ),
    ];

    const transferredERC20: RecipeERC20AmountRecipient = {
      tokenAddress: this.erc20Info.tokenAddress,
      decimals: this.erc20Info.decimals,
      amount: this.amount ?? erc20AmountForStep.expectedBalance,
      recipient: this.toAddress,
    };

    return {
      crossContractCalls,
      spentERC20Amounts: [transferredERC20],
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
