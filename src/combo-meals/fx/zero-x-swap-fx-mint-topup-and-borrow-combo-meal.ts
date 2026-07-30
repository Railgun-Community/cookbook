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
import { assertSwapTokenIsNotCollateral, fxCollateralERC20Info } from './util';

export type ZeroXSwap_FxMintTopupAndBorrow_ComboMealOpts =
  FxMintTopupAndBorrowRecipeOpts & {
    /** Any ERC-20 to lever up from. Swapped into the pool's collateral by the 0x leg. */
    sellERC20Info: RecipeERC20Info;
    swapSlippageBasisPoints: number;
    /** The EIP-7702 ephemeral EOA the batch executes as. */
    recipient: EphemeralExecutor | string;
  };

/**
 * Lever up an f(x) position from ANY token: swap into the pool's collateral,
 * then add collateral AND mint additional fxUSD in a single `operate()`.
 *
 * ```
 * private asset → 0x swap (→ pool collateral) → operate(+coll, +debt)
 *   → shield NFT + fxUSD
 * ```
 *
 * Outputs: the position NFT (same id) and the post-borrow-fee net fxUSD.
 *
 * Conservative seam, as with the other deposit-side combos: the exact-amount
 * `operate()` consumes the swap's guaranteed `minBuy`.
 */
export class ZeroXSwap_FxMintTopupAndBorrow_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + f(x) Topup and Borrow',
    description:
      'Swaps into the pool collateral, then adds collateral and borrows more of the debt token in one operate().',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly topupAndBorrowRecipe: FxMintTopupAndBorrowRecipe;

  constructor(opts: ZeroXSwap_FxMintTopupAndBorrow_ComboMealOpts) {
    super();
    const {
      sellERC20Info,
      swapSlippageBasisPoints,
      recipient,
      ...fxOpts
    } = opts;

    // See ZeroXSwap_FxMintOpen_ComboMeal: the executor binds the swap leg only;
    // operate() acts on msg.sender.
    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_FxMintTopupAndBorrow_ComboMeal recipient',
    );

    const buyERC20Info = fxCollateralERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      sellERC20Info,
      buyERC20Info,
      'sell',
      'ZeroXSwap_FxMintTopupAndBorrow_ComboMeal',
      'FxMintTopupAndBorrowRecipe',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.topupAndBorrowRecipe = new FxMintTopupAndBorrowRecipe(fxOpts);
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.topupAndBorrowRecipe];
  }

  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
