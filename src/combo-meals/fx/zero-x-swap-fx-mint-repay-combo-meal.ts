import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintRepayDebtRecipe,
  FxMintRepayDebtRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-repay-debt-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { assertSwapTokenIsNotCollateral, fxDebtERC20Info } from './util';

export type ZeroXSwap_FxMintRepay_ComboMealOpts = FxMintRepayDebtRecipeOpts & {
  /** Any ERC-20 the holder has. Swapped into the pool's DEBT token. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  recipient: EphemeralExecutor | string;
};

/**
 * De-risk an f(x) position while holding **none of the debt token**: swap into
 * it first, then repay — in one combo.
 *
 * ```
 * private asset → 0x swap (→ pool debt token) → operate(positionId, 0, -repay)
 *   → shield position NFT + any unspent debt token
 * ```
 *
 * **`FxMintRepayDebtRecipe` said it had no combo variant "because there is no
 * collateral leg to swap into or out of". That reasons from the wrong axis.**
 * The constraint on a repay is not collateral, it is that f(x) accepts only the
 * debt token — fxUSD on a long, wstETH or WBTC on a short. A holder of anything
 * else cannot repay, exactly as they could not close, and the swap goes on the
 * DEBT side rather than the collateral side. The absent collateral leg is why
 * this combo is simpler than the close one, not why it was unnecessary.
 *
 * The case that makes it matter: a position's collateral ratio is deteriorating
 * and the holder wants to reduce debt rather than unwind. Under the previous
 * surface they first had to acquire the debt token in a separate, public
 * transaction — during the exact window where the position is at risk.
 *
 * Sizing has the same shape as `ZeroXSwap_FxMintClose_ComboMeal` and the same
 * hazard: `operate()` is built with an exact `repayAmount` and PoolManager pulls
 * `approveAmount`, while 0x V2 quotes are sell-amount only, so no quote can
 * promise an exact output. Size against the swap's GUARANTEED fill —
 * `quoteFxSwapRepay` does this. An oversized repay fails at build time when the
 * approve step is handed less than it was told to approve, which is the good
 * outcome: the alternative mines a batch that reshields everything having
 * repaid nothing.
 *
 * Unlike a close, an underfill here is merely a smaller repay rather than a
 * failed exit — the position survives either way. That makes a conservative
 * sizing cheap: repay what the fill guarantees, and repeat later if needed.
 */
export class ZeroXSwap_FxMintRepay_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + f(x) Repay Debt',
    description:
      'Swaps into the pool debt token and repays f(x) debt without withdrawing collateral.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly repayRecipe: FxMintRepayDebtRecipe;

  constructor(opts: ZeroXSwap_FxMintRepay_ComboMealOpts) {
    super();
    const { sellERC20Info, swapSlippageBasisPoints, recipient, ...fxOpts } =
      opts;

    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_FxMintRepay_ComboMeal recipient',
    );

    const buyERC20Info = fxDebtERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      sellERC20Info,
      buyERC20Info,
      'sell',
      'ZeroXSwap_FxMintRepay_ComboMeal',
      'FxMintRepayDebtRecipe',
      'debt',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.repayRecipe = new FxMintRepayDebtRecipe(fxOpts);
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.repayRecipe];
  }

  /**
   * Required. The swap output spans `[minBuy, expectedBuy]` and the repay pulls
   * an exact amount from it, so the seam must hand the repay the guaranteed
   * figure — the optimistic one reverts `operate()` on any below-expectation
   * fill, silently, under `requireSuccess = false`.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
