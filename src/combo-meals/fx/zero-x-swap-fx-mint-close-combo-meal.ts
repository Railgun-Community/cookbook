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
import { assertSwapTokenIsNotCollateral, fxDebtERC20Info } from './util';

export type ZeroXSwap_FxMintClose_ComboMealOpts = FxMintCloseRecipeOpts & {
  /**
   * Any ERC-20 the holder actually has. Swapped into the pool's DEBT token by
   * the 0x leg, because that is the only thing `operate()` will accept as
   * repayment.
   */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  recipient: EphemeralExecutor | string;
};

/**
 * Close an f(x) position while holding **none of the debt token**: swap into it
 * first, then close — in one combo.
 *
 * ```
 * private asset → 0x swap (→ pool debt token) → operate(close)
 *   → shield collateral + position NFT + any unspent debt token
 * ```
 *
 * **This is the gap that blocked the action outright.** A debt is repayable only
 * in the debt token: fxUSD for a long, and wstETH or WBTC for a short. Without
 * this combo a holder of anything else could not close at all — not "closed
 * inefficiently", could not close. Closing a short was the sharp edge, since it
 * needs the volatile asset in hand rather than the stablecoin most holders have.
 *
 * The buy side is derived from the pool, never passed in, so a quote cannot name
 * a token `operate()` will refuse. If the input already IS the debt token, use
 * {@link FxMintCloseRecipe} directly — this combo throws rather than quoting a
 * degenerate self-swap.
 *
 * **Sizing is the whole difficulty, and it runs opposite to the entry combo.**
 * `ZeroXSwap_FxMintOpen_ComboMeal` can consume whatever the swap delivers: an
 * underfill just opens a slightly smaller position. A close cannot. `operate()`
 * is built with an EXACT `repayAmount`, and the approval is
 * `repayAmount x (1 + repayFeeRatio)` — so the swap must deliver at least that,
 * and 0x V2 quotes are sell-amount only (`BaseAPIParamsV2` has no `buyAmount`),
 * meaning no quote can promise an exact output.
 *
 * So size the close against the swap's GUARANTEED output, not its expected one.
 * `quoteFxSwapClose` does this: it quotes the sell, feeds `minimumBuyAmount`
 * into `computeFxClose`, and returns options that fit. Sizing against
 * `buyERC20Amount` instead leaves the close short whenever the fill is merely
 * average.
 *
 * An undersized swap fails at BUILD time, not on chain: the seam is conservative,
 * so the close receives the guaranteed minimum, and `ApproveERC20SpenderStep`
 * rejects an `approveAmount` above the balance it was handed. That is the good
 * outcome — the alternative is a batch that mines with `CallError` and reshields
 * everything, having done nothing, at full gas cost.
 *
 * Side-agnostic. A long buys fxUSD to release wstETH/WBTC; a short buys
 * wstETH/WBTC to release fxUSD. Both come off the pool descriptor.
 *
 * To close AND leave into a third asset, this composes with neither leg of
 * `FxMintClose_ZeroXSwap_ComboMeal` — that one sells the withdrawn collateral.
 * Two swaps around one close is not expressible as a combo of combos; build it
 * as its own recipe list if it is ever needed.
 */
export class ZeroXSwap_FxMintClose_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + f(x) Close Position',
    description:
      'Swaps into the pool debt token and closes an f(x) position, long or short (shields the withdrawn collateral and the position NFT).',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly closeRecipe: FxMintCloseRecipe;

  constructor(opts: ZeroXSwap_FxMintClose_ComboMealOpts) {
    super();
    const { sellERC20Info, swapSlippageBasisPoints, recipient, ...fxOpts } =
      opts;

    // Validate once and thread the same address into the swap leg. The fx
    // recipe takes no executor: PoolManager.operate() pulls from and releases
    // to msg.sender, which IS the executing account.
    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_FxMintClose_ComboMeal recipient',
    );

    const buyERC20Info = fxDebtERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      sellERC20Info,
      buyERC20Info,
      'sell',
      'ZeroXSwap_FxMintClose_ComboMeal',
      'FxMintCloseRecipe',
      'debt',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.closeRecipe = new FxMintCloseRecipe(fxOpts);
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.closeRecipe];
  }

  /**
   * Required, unlike on the exit combo where the same flag is a deliberate
   * no-op. Here the upstream swap output genuinely spans `[minBuy, expectedBuy]`
   * and the close consumes an exact amount from it, so the seam must hand the
   * close the guaranteed figure. Feeding it the optimistic one would mean any
   * fill below expectation reverts `operate()` — and under `requireSuccess =
   * false` that reverts silently, mining a batch that did nothing.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
