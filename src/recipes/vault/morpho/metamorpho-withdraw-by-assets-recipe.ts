import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../../recipe';
import { Step } from '../../../steps/step';
import { MetaMorphoWithdrawByAssetsStep } from '../../../steps/vault/morpho/metamorpho-withdraw-by-assets-step';
import { MorphoVaultVersion } from '../../../steps/vault/morpho/morpho-vault-util';
import { RecipeConfig, StepInput } from '../../../models/export-models';
import { MIN_GAS_LIMIT_METAMORPHO_WITHDRAW } from '../../../models/min-gas-limits';
import {
  MorphoVaultAPI,
  MetaMorphoWithdrawQuote,
} from '../../../api/vault/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../../utils/7702';

/**
 * Withdraw an EXACT asset amount from a Morpho vault (ERC-4626
 * `withdraw(assets)`), routed to the executing ephemeral EOA (EIP-7702).
 * Assets-denominated: the asset output is exactly `withdrawAssets`; the shares
 * burned drift with the rate, so the caller must unshield at least the quote's
 * `maxShares` (conservative upper bound) — any leftover shares reshield. DIRECT
 * vault call, no approval leg (the EOA owns the shares and is `msg.sender`).
 *
 * Vault-version-agnostic (V1/V2 share the ERC-4626 surface); see
 * {@link MorphoVaultV1WithdrawRecipe} / {@link MorphoVaultV2WithdrawRecipe}.
 * For a shares-denominated exit that burns the full input, use the redeem recipe.
 *
 * Self-contained (0x-V2 style): queries vault metadata + the ERC-4626 withdraw
 * preview on-chain via {@link MorphoVaultAPI}.
 */
export class MorphoVaultWithdrawRecipe extends Recipe {
  readonly config: RecipeConfig;

  private readonly vaultAddress: string;
  private readonly withdrawAssets: bigint;
  private readonly slippageBasisPoints: bigint;
  private readonly recipient: string;
  private readonly provider: Provider;

  private quote?: MetaMorphoWithdrawQuote;

  constructor(
    vaultAddress: string,
    withdrawAssets: bigint,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
    version: MorphoVaultVersion = 'V1',
  ) {
    super();
    this.config = {
      name: `Morpho Vault ${version} Withdraw`,
      description: 'Withdraws an exact asset amount from an ERC-4626 Morpho vault.',
      minGasLimit: MIN_GAS_LIMIT_METAMORPHO_WITHDRAW,
    };
    this.vaultAddress = vaultAddress;
    this.withdrawAssets = withdrawAssets;
    this.slippageBasisPoints = slippageBasisPoints;
    this.recipient = resolveExecutorAddress(
      recipient,
      'MorphoVaultWithdrawRecipe recipient',
    );
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoVaultAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    // Fail early with a clear message if the vault's shares were not unshielded
    // into this recipe (the step would otherwise reject with a generic error).
    const hasShareInput = firstInternalStepInput.erc20Amounts.some(
      erc20Amount =>
        erc20Amount.tokenAddress.toLowerCase() ===
        this.vaultAddress.toLowerCase(),
    );
    if (!hasShareInput) {
      throw new Error(
        `MorphoVaultWithdrawRecipe: no vault-share input for ${this.vaultAddress}`,
      );
    }

    this.quote = await MorphoVaultAPI.getWithdrawQuote({
      vaultAddress: this.vaultAddress,
      withdrawAssets: this.withdrawAssets,
      slippageBasisPoints: this.slippageBasisPoints,
      recipient: this.recipient,
      provider: this.provider,
    });

    return [new MetaMorphoWithdrawByAssetsStep(this.quote)];
  }
}

/** Withdraw an exact asset amount from a Morpho Vault V1 (MetaMorpho). */
export class MorphoVaultV1WithdrawRecipe extends MorphoVaultWithdrawRecipe {
  constructor(
    vaultAddress: string,
    withdrawAssets: bigint,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(
      vaultAddress,
      withdrawAssets,
      slippageBasisPoints,
      recipient,
      provider,
      'V1',
    );
  }
}

/** Withdraw an exact asset amount from a Morpho Vault V2. */
export class MorphoVaultV2WithdrawRecipe extends MorphoVaultWithdrawRecipe {
  constructor(
    vaultAddress: string,
    withdrawAssets: bigint,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(
      vaultAddress,
      withdrawAssets,
      slippageBasisPoints,
      recipient,
      provider,
      'V2',
    );
  }
}
