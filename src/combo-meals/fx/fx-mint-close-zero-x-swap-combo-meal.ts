import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintCloseRecipe,
  FxMintCloseRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-close-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { assertSwapTokenIsNotCollateral, fxCollateralERC20Info } from './util';

export type FxMintClose_ZeroXSwap_ComboMealOpts = FxMintCloseRecipeOpts & {
  /** Any ERC-20 to exit into. The withdrawn collateral is swapped to this. */
  buyERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  recipient: EphemeralExecutor | string;
};

/**
 * Private f(x) exit into ANY token: close (or partially close) a Long position,
 * then swap the withdrawn collateral into a desired asset — in one combo.
 *
 * ```
 * unshield fxUSD + NFT → operate(close) → 0x swap (collateral → desired)
 *   → shield asset (+ NFT on partial close, + unspent fxUSD)
 * ```
 *
 * The sell side is derived from the pool, never passed in — the swap can only
 * ever sell what the close actually withdraws.
 *
 * Two outputs beyond the obvious one:
 *   - **partial close** keeps the position NFT, which transits the swap leg
 *     untouched and shields back to the user; a full close burns it (`0n`).
 *   - **unspent fxUSD** from the close (see FxMintClosePositionStep's orphan
 *     pass-through) rides the seam as a second ERC-20. The swap recipe does not
 *     handle it, so the recipe engine's epilogue reshields it.
 */
export class FxMintClose_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'f(x) Close Position + 0x Swap',
    description:
      'Closes an f(x) Long position and swaps the withdrawn collateral into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly closeRecipe: FxMintCloseRecipe;
  private readonly swapRecipe: ZeroXV2SwapRecipe;

  constructor(opts: FxMintClose_ZeroXSwap_ComboMealOpts) {
    super();
    const {
      buyERC20Info,
      swapSlippageBasisPoints,
      recipient,
      ...fxOpts
    } = opts;

    const executor = resolveExecutorAddress(
      recipient,
      'FxMintClose_ZeroXSwap_ComboMeal recipient',
    );

    const sellERC20Info = fxCollateralERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      buyERC20Info,
      sellERC20Info,
      'buy',
      'FxMintClose_ZeroXSwap_ComboMeal',
      'FxMintCloseRecipe',
    );

    this.closeRecipe = new FxMintCloseRecipe(fxOpts);
    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.closeRecipe, this.swapRecipe];
  }

  /**
   * A no-op today — `withdrawColl` is pre-computed by `computeFxClose`, so
   * FxMintClosePositionStep declares `minBalance === expectedBalance` and the
   * seam has no spread to be conservative about.
   *
   * Set deliberately, not accidentally: the downstream swap sells an EXACT
   * amount, so the day the close side gains any non-deterministic component this
   * flag is what stops the batch reverting on an underfill. Do not "clean it
   * up" as dead configuration.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
