import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info } from '../../../utils/token';
import { Step } from '../../step';
import { MetaMorphoVaultContract } from '../../../contract/vault/morpho/metamorpho-vault-contract';
import { MetaMorphoWithdrawQuote } from '../../../api/vault/morpho';

/**
 * Withdraws an EXACT asset amount from an ERC-4626 Morpho vault via
 * `withdraw(assets, receiver, owner)`, routed to the ephemeral EOA (EIP-7702).
 *
 * Contrast with the redeem step (shares-in, non-deterministic asset out): here
 * the ASSET output is deterministic (exactly `withdrawAssets`), while the
 * SHARES burned drift with the rate. The quote's `maxShares` is a conservative
 * upper bound on consumption, so the caller must unshield >= `maxShares` shares;
 * whatever is not burned reshields. No approval leg — `owner` is the EOA and
 * `msg.sender`.
 */
export class MetaMorphoWithdrawByAssetsStep extends Step {
  readonly config: StepConfig = {
    name: 'MetaMorpho Vault Withdraw (exact assets)',
    description: 'Withdraws an exact asset amount from an ERC-4626 Morpho vault.',
    hasNonDeterministicOutput: true,
  };

  private readonly quote: MetaMorphoWithdrawQuote;

  constructor(quote: MetaMorphoWithdrawQuote) {
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
      withdrawAssets,
      maxShares,
      receiver,
      owner,
    } = this.quote;
    const { erc20Amounts } = input;

    const shareInfo: RecipeERC20Info = {
      tokenAddress: vaultAddress,
      decimals: shareDecimals,
    };
    // Consume up to maxShares (conservative); the remainder reshields.
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      erc20Amounts,
      erc20Amount => compareERC20Info(erc20Amount, shareInfo),
      maxShares,
    );

    const contract = new MetaMorphoVaultContract(vaultAddress);
    const crossContractCall = await contract.createWithdraw(
      withdrawAssets,
      receiver,
      owner,
    );

    const spentShares: RecipeERC20AmountRecipient = {
      ...shareInfo,
      amount: maxShares,
      recipient: `${vaultAddress} (Morpho vault)`,
    };
    const outputAsset: StepOutputERC20Amount = {
      tokenAddress: assetAddress,
      decimals: assetDecimals,
      // Asset output is deterministic: withdraw() sends exactly withdrawAssets.
      expectedBalance: withdrawAssets,
      minBalance: withdrawAssets,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentShares],
      outputERC20Amounts: [outputAsset, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
