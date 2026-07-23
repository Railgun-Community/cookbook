import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../../recipe';
import { Step } from '../../../steps/step';
import { MetaMorphoWithdrawStep } from '../../../steps/vault/morpho/metamorpho-withdraw-step';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../../models/export-models';
import { MIN_GAS_LIMIT_METAMORPHO_WITHDRAW } from '../../../models/min-gas-limits';
import {
  MorphoVaultAPI,
  MetaMorphoRedeemQuote,
} from '../../../api/vault/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../../utils/7702';
import { findFirstInputERC20Amount } from '../../../utils/filters';

/**
 * Redeem MetaMorpho ERC-4626 shares for the underlying asset, routed to the
 * executing ephemeral EOA (EIP-7702). No approval leg — the EOA owns the
 * shares and is `msg.sender`.
 *
 * Self-contained (0x-V2 style): queries vault metadata + the ERC-4626 redeem
 * preview on-chain via {@link MorphoVaultAPI}. Asset output is non-deterministic
 * across blocks, so the withdraw step tolerates `[minAssets, expectedAssets]`.
 */
export class MetaMorphoWithdrawRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'MetaMorpho Vault Withdraw',
    description: 'Redeems shares from an ERC-4626 MetaMorpho vault.',
    minGasLimit: MIN_GAS_LIMIT_METAMORPHO_WITHDRAW,
  };

  private readonly vaultAddress: string;
  private readonly slippageBasisPoints: bigint;
  private readonly recipient: string;
  private readonly provider: Provider;

  private quote?: MetaMorphoRedeemQuote;

  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super();
    this.vaultAddress = vaultAddress;
    this.slippageBasisPoints = slippageBasisPoints;
    this.recipient = resolveExecutorAddress(
      recipient,
      'MetaMorphoWithdrawRecipe recipient',
    );
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoVaultAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { erc20Amounts } = firstInternalStepInput;

    // The share token IS the vault contract (ERC-4626). Read its decimals
    // on-chain, then match the unshielded share input.
    const vaultData = await MorphoVaultAPI.getVaultData(
      this.vaultAddress,
      this.provider,
    );
    const shareInfo: RecipeERC20Info = {
      tokenAddress: this.vaultAddress,
      decimals: vaultData.shareDecimals,
    };
    const shareInput = findFirstInputERC20Amount(erc20Amounts, shareInfo);

    this.quote = await MorphoVaultAPI.getRedeemQuote({
      vaultAddress: this.vaultAddress,
      redeemShares: shareInput.amount,
      slippageBasisPoints: this.slippageBasisPoints,
      recipient: this.recipient,
      provider: this.provider,
    });

    return [new MetaMorphoWithdrawStep(this.quote)];
  }
}
