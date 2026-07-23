import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../../recipe';
import { Step } from '../../../steps/step';
import { MetaMorphoWithdrawStep } from '../../../steps/vault/morpho/metamorpho-withdraw-step';
import { MorphoVaultVersion } from '../../../steps/vault/morpho/morpho-vault-util';
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
 * Redeem Morpho vault shares (ERC-4626 `redeem(shares)`) for the underlying
 * asset, routed to the executing ephemeral EOA (EIP-7702). Shares-denominated:
 * burns the exact input shares, asset output is non-deterministic. DIRECT vault
 * call — no approval leg (the EOA owns the shares and is `msg.sender`), matching
 * Morpho's own SDK which emits withdrawals/redemptions as direct calls.
 *
 * Vault-version-agnostic (V1/V2 share the ERC-4626 surface); see
 * {@link MorphoVaultV1RedeemRecipe} / {@link MorphoVaultV2RedeemRecipe}.
 * For an exact-asset-out exit, use the withdraw-by-assets recipe instead.
 *
 * Self-contained (0x-V2 style): queries vault metadata + the ERC-4626 redeem
 * preview on-chain via {@link MorphoVaultAPI}. Asset output is non-deterministic
 * across blocks, so the redeem step tolerates `[minAssets, expectedAssets]`.
 */
export class MorphoVaultRedeemRecipe extends Recipe {
  readonly config: RecipeConfig;

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
    version: MorphoVaultVersion = 'V1',
  ) {
    super();
    this.config = {
      name: `Morpho Vault ${version} Redeem`,
      description: 'Redeems shares from an ERC-4626 Morpho vault.',
      minGasLimit: MIN_GAS_LIMIT_METAMORPHO_WITHDRAW,
    };
    this.vaultAddress = vaultAddress;
    this.slippageBasisPoints = slippageBasisPoints;
    this.recipient = resolveExecutorAddress(
      recipient,
      'MorphoVaultRedeemRecipe recipient',
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

/** Redeem shares from a Morpho Vault V1 (MetaMorpho, ERC-4626). */
export class MorphoVaultV1RedeemRecipe extends MorphoVaultRedeemRecipe {
  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(vaultAddress, slippageBasisPoints, recipient, provider, 'V1');
  }
}

/** Redeem shares from a Morpho Vault V2 (ERC-4626; identical redeem surface). */
export class MorphoVaultV2RedeemRecipe extends MorphoVaultRedeemRecipe {
  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(vaultAddress, slippageBasisPoints, recipient, provider, 'V2');
  }
}
