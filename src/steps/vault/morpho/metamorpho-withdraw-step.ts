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
import { MetaMorphoRedeemQuote } from '../../../api/vault/morpho';

/**
 * Redeems MetaMorpho ERC-4626 shares for the underlying asset, routed to the
 * ephemeral EOA (`receiver`/`owner`, EIP-7702).
 *
 * No approval leg: `owner` is the ephemeral EOA and also `msg.sender` under
 * 7702, so it is always authorised to burn its own shares. Asset output is
 * non-deterministic across blocks, so the step declares `[minAssets,
 * expectedAssets]`.
 *
 * **Failure semantics (7702).** Benign: shares are untouched at the executor and
 * reshield (the usual cause, vault illiquidity, is transient); on success the
 * redeemed asset is a declared output and reshields.
 */
export class MetaMorphoWithdrawStep extends Step {
  readonly config: StepConfig = {
    name: 'MetaMorpho Vault Withdraw',
    description: 'Redeems shares from an ERC-4626 MetaMorpho vault.',
    hasNonDeterministicOutput: true,
  };

  private readonly quote: MetaMorphoRedeemQuote;

  constructor(quote: MetaMorphoRedeemQuote) {
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
      redeemShares,
      expectedAssets,
      minAssets,
      receiver,
      owner,
    } = this.quote;
    const { erc20Amounts } = input;

    const shareInfo: RecipeERC20Info = {
      tokenAddress: vaultAddress,
      decimals: shareDecimals,
    };
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      erc20Amounts,
      erc20Amount => compareERC20Info(erc20Amount, shareInfo),
      redeemShares,
    );

    const contract = new MetaMorphoVaultContract(vaultAddress);
    const crossContractCall = await contract.createRedeem(
      redeemShares,
      receiver,
      owner,
    );

    const spentShares: RecipeERC20AmountRecipient = {
      ...shareInfo,
      amount: redeemShares,
      recipient: `${vaultAddress} (MetaMorpho vault)`,
    };
    const outputAsset: StepOutputERC20Amount = {
      tokenAddress: assetAddress,
      decimals: assetDecimals,
      expectedBalance: expectedAssets,
      minBalance: minAssets,
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
