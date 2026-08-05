import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintTopupAndBorrowRecipe,
  FxMintTopupAndBorrowRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-topup-and-borrow-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import {
  assertSwapTokenIsNotCollateral,
  fxBorrowSwapSeamAmount,
  fxDebtERC20Info,
} from './util';

export type FxMintTopupAndBorrow_ZeroXSwap_ComboMealOpts =
  FxMintTopupAndBorrowRecipeOpts & {
    /**
     * Any ERC-20 to take the borrowing in. The freshly minted debt token is
     * swapped into this by the 0x leg. May be the pool's own collateral — see
     * the class docblock.
     */
    buyERC20Info: RecipeERC20Info;
    swapSlippageBasisPoints: number;
    /** The EIP-7702 ephemeral EOA the batch executes as. */
    recipient: EphemeralExecutor | string;
  };

/**
 * Lever up an f(x) position and take the borrowing in ANY token — in one combo.
 *
 * ```
 * unshield collateral + NFT → operate(positionId, +coll, +debt)
 *   → 0x swap (debt token → desired) → shield asset + NFT
 * ```
 *
 * The exit-side counterpart of `ZeroXSwap_FxMintTopupAndBorrow_ComboMeal`, which
 * swaps INTO the collateral before the same `operate()`. The two sit on opposite
 * sides of the position leg and compose in principle but not as combos: two
 * swaps around one `operate()` is a three-recipe list, not a combo of combos.
 *
 * Same shape as {@link FxMintBorrowMore_ZeroXSwap_ComboMeal}, plus a collateral
 * leg. That leg is deterministic and self-sizing: `FxMintTopupAndBorrowRecipe`
 * takes `collDelta` from the unshielded balance rather than an argument, so
 * there is no amount for the caller to get wrong and no interaction with the
 * swap leg — the collateral is fully consumed by `operate()` before the swap
 * runs, and the seam carries only the borrowed debt token.
 *
 * **The swap sells the post-fee NET.** A long charges 0.5% on the borrow:
 * `operate(pool, 1912, 0, +1e18)` on `wstETH-Long` minted 0.995 fxUSD to the
 * caller and 0.005 to f(x)'s fee recipient (mainnet `0x09a3bd9d…`, block
 * 25078146). Ordering the gross moves 0.5% more than exists; 0x's
 * `transferFrom` reverts and, under `requireSuccess = false`, the batch mines
 * having deposited the collateral and sold nothing. `FxMintAdjustPositionStep`
 * declares the net, so the seam is correct by construction;
 * {@link debtTokenToSell} exposes the figure.
 *
 * `supplyFeeRatio` flows through to the recipe via the opts spread. It is
 * ERC-20-neutral — the manager pulls the full collateral either way — and only
 * sharpens `recipeOutput.outputPositions`, exact on a long and 0.3% high on a
 * short when omitted. It does NOT affect the swap.
 *
 * **Buying the pool's own collateral is allowed here, and is the interesting
 * case**: deposit wstETH, mint fxUSD, sell the fxUSD back to wstETH — a leg of a
 * leverage loop, in one private batch. The guard only rejects a buy side equal
 * to the DEBT token, which would be the degenerate self-swap. Note the bought
 * collateral SHIELDS rather than re-depositing; each turn of the loop is its own
 * batch.
 */
export class FxMintTopupAndBorrow_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'f(x) Topup and Borrow + 0x Swap',
    description:
      'Adds collateral and mints additional debt on an f(x) position in one operate(), then swaps the borrowing into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  /**
   * What the 0x leg will be asked to sell — `additionalDebt` net of f(x)'s
   * borrow fee. See {@link FxMintBorrowMore_ZeroXSwap_ComboMeal.debtTokenToSell}.
   */
  readonly debtTokenToSell: bigint;

  private readonly topupAndBorrowRecipe: FxMintTopupAndBorrowRecipe;
  private readonly swapRecipe: ZeroXV2SwapRecipe;

  constructor(opts: FxMintTopupAndBorrow_ZeroXSwap_ComboMealOpts) {
    super();
    const { buyERC20Info, swapSlippageBasisPoints, recipient, ...fxOpts } =
      opts;

    const executor = resolveExecutorAddress(
      recipient,
      'FxMintTopupAndBorrow_ZeroXSwap_ComboMeal recipient',
    );

    const sellERC20Info = fxDebtERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      buyERC20Info,
      sellERC20Info,
      'buy',
      'FxMintTopupAndBorrow_ZeroXSwap_ComboMeal',
      'FxMintTopupAndBorrowRecipe',
      'debt',
    );

    // Recipe first — its constructor rejects `additionalDebt <= 0`, which the
    // seam arithmetic below assumes.
    this.topupAndBorrowRecipe = new FxMintTopupAndBorrowRecipe(fxOpts);
    this.debtTokenToSell = fxBorrowSwapSeamAmount(
      fxOpts.additionalDebt,
      fxOpts.borrowFeeRatio,
      'FxMintTopupAndBorrow_ZeroXSwap_ComboMeal',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.topupAndBorrowRecipe, this.swapRecipe];
  }

  /**
   * A no-op today, for the reason given at length on
   * {@link FxMintBorrowMore_ZeroXSwap_ComboMeal.conservativeSeamAmounts}: the
   * borrowed debt is declared `minBalance === expectedBalance`, so there is no
   * spread, and the residual exposure — a `borrowFeeRatio` that governance moved
   * since the read — is one no seam flag can cover.
   *
   * The collateral leg adds nothing to that analysis. `FxMintAdjustPositionStep`
   * clamps `collDelta` to the input's `minBalance`; the input here comes
   * straight from an unshield, where `min === expected`, so the clamp is inert
   * and no collateral surplus reaches the seam. That changes the moment anything
   * non-deterministic is put in front of the collateral leg, which is precisely
   * when this flag stops being a no-op.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
