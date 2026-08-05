import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueRepayRecipe } from '../../recipes/morpho/blue-repay-recipe';
import { MarketParams } from '../../steps/morpho/morpho-blue-util';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
} from '../../utils/7702';
import {
  assertMorphoBlueSwapTokenDiffers,
  morphoBlueLoanERC20Info,
} from './util';

export type ZeroXSwap_MorphoBlueRepay_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 the holder has. Swapped into the market's LOAN token. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /**
   * Blue `onBehalf` — whose debt falls. Defaults to the executor.
   *
   * Repay is ungated: Morpho lets anyone repay anyone's debt. That also makes it
   * irreversible in the wrong direction — repaying the wrong owner is a gift,
   * and nothing reverts to tell you.
   */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * De-risk a Morpho Blue position while holding **none of the loan token**: swap
 * into it first, then repay — in one combo.
 *
 * ```
 * private asset → 0x swap (→ loan token) → repay → shield any unspent loan token
 * ```
 *
 * The buy side is derived from the market. A debt is repayable only in the loan
 * token, so letting the caller name it would allow a quote for a token Blue will
 * not accept.
 *
 * ## Sizing: exact-amount repay, non-deterministic swap
 *
 * `Morpho.repay(assets)` is exact and reverts on over-repay (borrow-share
 * underflow), while 0x V2 quotes are sell-amount only — no quote can promise an
 * exact output. The guaranteed-fill discipline that `quoteFxSwapClose` applies
 * by hand is applied here **structurally**, by two properties acting together:
 *
 *   1. `conservativeSeamAmounts` hands the repay recipe the swap's
 *      `minimumBuyAmount`, not its expected fill.
 *   2. `MorphoBlueRepayRecipe` reads the repay amount out of that input rather
 *      than taking it as a parameter, and `MorphoBlueAPI.getRepayQuote` caps it
 *      at the position's current debt.
 *
 * So the encoded `repay(assets)` can never exceed either the guaranteed fill or
 * the debt, and there is no figure for a caller to get wrong. A better-than-
 * quoted fill leaves surplus loan token at the executor, which reshields.
 *
 * What this does NOT protect against is intent: if the guaranteed fill falls
 * short of the debt, the batch quietly performs a smaller repay than the caller
 * may have wanted. That is benign — the position survives either way and the
 * repay can be repeated — but it is invisible from the built batch, which is
 * what `quoteMorphoBlueSwapRepay` reports.
 *
 * **A full repay does not close the position.** The collateral stays where it
 * is; the holder keeps an unlevered position rather than exiting. Use
 * `ZeroXSwap_MorphoBlueClosePosition_ComboMeal` when the intent is to get the
 * collateral back.
 */
export class ZeroXSwap_MorphoBlueRepay_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + Morpho Blue Repay',
    description:
      'Swaps into the market loan token and repays Morpho Blue debt without withdrawing collateral.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: ZeroXSwap_MorphoBlueRepay_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: ZeroXSwap_MorphoBlueRepay_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'ZeroXSwap_MorphoBlueRepay_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.sellERC20Info,
      opts.market.loanToken,
      'sell',
      'ZeroXSwap_MorphoBlueRepay_ComboMeal',
      'MorphoBlueRepayRecipe',
      'loan',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const { market, sellERC20Info, swapSlippageBasisPoints, owner, provider } =
      this.opts;

    const buyERC20Info = await morphoBlueLoanERC20Info(market, provider);

    return [
      new ZeroXV2SwapRecipe(
        sellERC20Info,
        buyERC20Info,
        swapSlippageBasisPoints,
        this.executor,
      ),
      new MorphoBlueRepayRecipe(market, owner ?? this.executor, provider),
    ];
  }

  /**
   * Required, and load-bearing rather than defensive. It is what makes the
   * repay track the guaranteed fill: without it the recipe reads the OPTIMISTIC
   * buy amount out of the seam, encodes `repay(expectedFill)`, and any
   * below-expectation fill leaves Blue pulling more loan token than the executor
   * holds. That reverts, `requireSuccess = false` swallows it, and the batch
   * mines having repaid nothing.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
