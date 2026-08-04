import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../../recipe';
import { Step } from '../../../steps/step';
import { ApproveERC20SpenderStep } from '../../../steps/token/erc20/approve-erc20-spender-step';
import { MetaMorphoDepositStep } from '../../../steps/vault/morpho/metamorpho-deposit-step';
import { MorphoVaultVersion } from '../../../steps/vault/morpho/morpho-vault-util';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../../models/export-models';
import { MIN_GAS_LIMIT_METAMORPHO_DEPOSIT } from '../../../models/min-gas-limits';
import {
  MorphoVaultAPI,
  MetaMorphoDepositQuote,
} from '../../../api/vault/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../../utils/7702';
import { findFirstInputERC20Amount } from '../../../utils/filters';

/**
 * Deposit an ERC-20 asset into a Morpho vault (ERC-4626), minting shares to the
 * executing ephemeral EOA (EIP-7702). This is the DIRECT ERC-4626 route
 * (`approve` + `deposit`) — the default for simple one-shot vault deposits;
 * Bundler3 is reserved for compositions.
 *
 * Vault-version-agnostic: V1 (MetaMorpho) and V2 (Morpho Vault V2) share the
 * same ERC-4626 surface, so this one recipe serves both; the `version` only
 * labels the config. Use {@link MorphoVaultV1DepositRecipe} /
 * {@link MorphoVaultV2DepositRecipe} for an explicit generation.
 *
 * Self-contained (0x-V2 style): the recipe queries vault metadata + the
 * ERC-4626 deposit preview on-chain via {@link MorphoVaultAPI} using the
 * supplied provider — callers pass only the vault, slippage, executor, and
 * provider, never a pre-fetched rate. Minted shares are non-deterministic
 * across blocks, so the deposit step tolerates `[minShares, expectedShares]`.
 *
 * The quote also enforces the Vault V2 gate check, so this recipe refuses to
 * build against a vault whose gates would reject the ephemeral executor — see
 * {@link MorphoVaultAPI.assertVaultUsable}. That guard cannot live in this
 * constructor (it is a network read; constructors are sync), but there is no
 * path from here to a step that bypasses the quote.
 *
 * Approval is scoped to the EXACT deposit amount and granted to the vault only;
 * `deposit` consumes it in full, so no residual allowance is left on the
 * ephemeral account.
 */
export class MorphoVaultDepositRecipe extends Recipe {
  readonly config: RecipeConfig;

  private readonly vaultAddress: string;
  private readonly slippageBasisPoints: bigint;
  private readonly recipient: string;
  private readonly provider: Provider;

  private quote?: MetaMorphoDepositQuote;

  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
    version: MorphoVaultVersion = 'V1',
  ) {
    super();
    this.config = {
      name: `Morpho Vault ${version} Deposit`,
      description:
        'Auto-approves and deposits an ERC-20 into an ERC-4626 Morpho vault.',
      minGasLimit: MIN_GAS_LIMIT_METAMORPHO_DEPOSIT,
    };
    this.vaultAddress = vaultAddress;
    this.slippageBasisPoints = slippageBasisPoints;
    // Validate + normalise the 7702 executor up front so a misconfigured
    // recipient fails at construction, not deep inside step-building.
    this.recipient = resolveExecutorAddress(
      recipient,
      'MorphoVaultDepositRecipe recipient',
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

    // Discover the vault's underlying asset on-chain, then match the unshielded
    // input for that asset.
    const vaultData = await MorphoVaultAPI.getVaultData(
      this.vaultAddress,
      this.provider,
    );
    const assetInfo: RecipeERC20Info = {
      tokenAddress: vaultData.assetAddress,
      decimals: vaultData.assetDecimals,
    };
    const assetInput = findFirstInputERC20Amount(erc20Amounts, assetInfo);

    this.quote = await MorphoVaultAPI.getDepositQuote({
      vaultAddress: this.vaultAddress,
      depositAssets: assetInput.amount,
      slippageBasisPoints: this.slippageBasisPoints,
      recipient: this.recipient,
      provider: this.provider,
    });

    return [
      // Exact-amount approval to the vault only; deposit consumes it fully →
      // zero residual allowance on the single-use ephemeral account.
      new ApproveERC20SpenderStep(
        this.vaultAddress,
        assetInfo,
        this.quote.depositAssets,
      ),
      new MetaMorphoDepositStep(this.quote),
    ];
  }
}

/** Deposit into a Morpho Vault V1 (MetaMorpho, ERC-4626). */
export class MorphoVaultV1DepositRecipe extends MorphoVaultDepositRecipe {
  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(vaultAddress, slippageBasisPoints, recipient, provider, 'V1');
  }
}

/** Deposit into a Morpho Vault V2 (ERC-4626; identical deposit surface). */
export class MorphoVaultV2DepositRecipe extends MorphoVaultDepositRecipe {
  constructor(
    vaultAddress: string,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super(vaultAddress, slippageBasisPoints, recipient, provider, 'V2');
  }
}
