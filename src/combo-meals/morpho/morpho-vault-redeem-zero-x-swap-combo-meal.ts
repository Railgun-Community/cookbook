import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoVaultRedeemRecipe } from '../../recipes/vault/morpho/metamorpho-withdraw-recipe';
import { MorphoVaultVersion } from '../../steps/vault/morpho/morpho-vault-util';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Private vault exit: redeem Morpho vault shares for the underlying, then swap
 * the underlying into a desired asset and shield it — in one combo.
 *
 * ```
 * unshield vault shares → redeem → 0x swap (vault asset → desired) → shield asset
 * ```
 *
 * `sellERC20Info` MUST be the vault's underlying asset (the redeem output). If
 * no swap is needed, use `MorphoVaultRedeemRecipe` directly.
 */
export class MorphoVaultRedeem_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'Morpho Vault Redeem + 0x Swap',
    description:
      'Redeems Morpho vault shares and swaps the underlying into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly redeemRecipe: MorphoVaultRedeemRecipe;
  private readonly swapRecipe: ZeroXV2SwapRecipe;

  constructor(
    vaultAddress: string,
    vaultSlippageBasisPoints: bigint,
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    swapSlippageBasisPoints: number,
    recipient: EphemeralExecutor | string,
    provider: Provider,
    vaultVersion: MorphoVaultVersion = 'V1',
  ) {
    super();
    const executor = resolveExecutorAddress(
      recipient,
      'MorphoVaultRedeem_ZeroXSwap_ComboMeal recipient',
    );
    this.redeemRecipe = new MorphoVaultRedeemRecipe(
      vaultAddress,
      vaultSlippageBasisPoints,
      executor,
      provider,
      vaultVersion,
    );
    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.redeemRecipe, this.swapRecipe];
  }
}
