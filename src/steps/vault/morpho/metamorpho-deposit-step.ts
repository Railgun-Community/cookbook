import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils/token';
import { Step } from '../../step';
import { MetaMorphoVaultContract } from '../../../contract/vault/morpho/metamorpho-vault-contract';
import { MetaMorphoDepositQuote } from '../../../api/vault/morpho';

/**
 * Deposits an ERC-20 asset into a MetaMorpho ERC-4626 vault and mints shares to
 * the ephemeral EOA (`receiver`, EIP-7702).
 *
 * Pure step: it consumes a {@link MetaMorphoDepositQuote} produced by the
 * recipe (which does the on-chain preview + 7702 receiver resolution). Share
 * output is non-deterministic across blocks, so the step declares
 * `[minShares, expectedShares]` and marks itself non-deterministic.
 */
export class MetaMorphoDepositStep extends Step {
  readonly config: StepConfig = {
    name: 'MetaMorpho Vault Deposit',
    description: 'Deposits into an ERC-4626 MetaMorpho vault.',
    hasNonDeterministicOutput: true,
  };

  private readonly quote: MetaMorphoDepositQuote;

  constructor(quote: MetaMorphoDepositQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      vaultAddress,
      assetAddress,
      assetDecimals,
      shareDecimals,
      depositAssets,
      expectedShares,
      minShares,
      receiver,
    } = this.quote;
    const { erc20Amounts } = input;

    const assetInfo: RecipeERC20Info = {
      tokenAddress: assetAddress,
      decimals: assetDecimals,
    };
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      erc20Amounts,
      erc20Amount =>
        compareERC20Info(erc20Amount, assetInfo) &&
        isApprovedForSpender(erc20Amount, vaultAddress),
      depositAssets,
    );

    const contract = new MetaMorphoVaultContract(vaultAddress);
    const crossContractCall = await contract.createDeposit(
      depositAssets,
      receiver,
    );

    const spentERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...assetInfo,
      amount: depositAssets,
      recipient: vaultAddress,
    };
    const outputShares: StepOutputERC20Amount = {
      tokenAddress: vaultAddress,
      decimals: shareDecimals,
      expectedBalance: expectedShares,
      minBalance: minShares,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentERC20AmountRecipient],
      outputERC20Amounts: [outputShares, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
