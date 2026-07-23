import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoVaultDepositRecipe } from '../../recipes/vault/morpho/metamorpho-deposit-recipe';
import { MorphoVaultVersion } from '../../steps/vault/morpho/morpho-vault-util';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Private vault entry: swap an unshielded asset into the vault's underlying,
 * then deposit into a Morpho vault and shield the shares — in one combo.
 *
 * ```
 * private asset → 0x swap (→ vault asset) → Morpho vault deposit → shield shares
 * ```
 *
 * `buyERC20Info` MUST be the vault's underlying asset. If no swap is needed
 * (input already is the vault asset), use `MorphoVaultDepositRecipe` directly.
 */
export class ZeroXSwap_MorphoVaultDeposit_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + Morpho Vault Deposit',
    description:
      'Swaps into the vault asset and deposits into a Morpho vault (shields shares).',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly depositRecipe: MorphoVaultDepositRecipe;

  constructor(
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    swapSlippageBasisPoints: number,
    vaultAddress: string,
    vaultSlippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
    vaultVersion: MorphoVaultVersion = 'V1',
  ) {
    super();
    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_MorphoVaultDeposit_ComboMeal recipient',
    );
    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.depositRecipe = new MorphoVaultDepositRecipe(
      vaultAddress,
      vaultSlippageBasisPoints,
      executor,
      provider,
      vaultVersion,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.depositRecipe];
  }
}
