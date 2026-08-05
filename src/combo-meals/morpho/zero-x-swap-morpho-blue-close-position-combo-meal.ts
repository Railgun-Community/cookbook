import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueClosePositionRecipe } from '../../recipes/morpho/blue-close-position-recipe';
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

export type ZeroXSwap_MorphoBlueClosePosition_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 the holder has. Swapped into the market's LOAN token. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /**
   * Buffer on the shares→assets conversion, 1..10000 bps. Sizes
   * `maxRepaidAssets`, the conservative loan budget the repay leg spends.
   * Threaded straight through to `MorphoBlueClosePositionRecipe`, which
   * requires it to be non-zero.
   */
  repaySlippageBasisPoints: bigint;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — whose position is closed. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * Exit a Morpho Blue position while holding **none of the loan token**: swap
 * into it, repay the whole debt by shares, and withdraw all the collateral — in
 * one combo.
 *
 * ```
 * private asset → 0x swap (→ loan token) → repay(shares) → withdrawCollateral(all)
 *   → shield collateral + unspent loan token
 * ```
 *
 * ## Why this is not `ZeroXSwap_MorphoBlueRepay_ComboMeal` with an extra leg
 *
 * The repay combo is assets-denominated and self-sizing, so a short fill is
 * merely a smaller repay. A close cannot absorb a short fill the same way: the
 * withdraw leg takes ALL the collateral, and Blue's health check refuses that
 * while any debt remains. Under `requireSuccess = false` the refusal is
 * swallowed, so an under-funded close mines with the debt partly repaid and the
 * collateral still inside Blue — the position half-unwound and still public.
 *
 * Two things prevent that, and they are the same two the f(x) close relies on:
 *
 *   - **Shares, not assets.** `MorphoBlueRepaySharesStep` encodes
 *     `repay(0, shares)`, which burns all the shares or none. Interest accruing
 *     between build and inclusion cannot leave a residue the withdraw then trips
 *     over, which an assets-denominated "repay the whole debt" always would.
 *   - **A build-time budget check.** `MorphoBlueClosePositionRecipe` refuses to
 *     build unless its loan input covers `maxRepaidAssets`. With
 *     `conservativeSeamAmounts` that input is the swap's `minimumBuyAmount`, so
 *     the check runs against the GUARANTEED fill and not the expected one. This
 *     is where `quoteFxSwapClose`'s discipline lands for Blue — in an existing
 *     recipe guard fed a conservative seam, rather than in a hand-computed
 *     amount.
 *
 * `quoteMorphoBlueSwapClose` runs the same comparison before the combo is built,
 * so the caller can size the SELL side rather than discover the shortfall from a
 * recipe error that talks about an unshield this combo never performs.
 *
 * The collateral comes back as the collateral token. To leave into some third
 * asset, follow with `MorphoBlueClosePosition_ZeroXSwap_ComboMeal` instead — one
 * batch cannot do both swaps, because the collateral does not exist until the
 * close has run and the recipe engine builds each swap's quote up front.
 */
export class ZeroXSwap_MorphoBlueClosePosition_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + Morpho Blue Close Position',
    description:
      'Swaps into the market loan token, repays all Morpho Blue debt by shares, and withdraws all collateral.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: ZeroXSwap_MorphoBlueClosePosition_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: ZeroXSwap_MorphoBlueClosePosition_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'ZeroXSwap_MorphoBlueClosePosition_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.sellERC20Info,
      opts.market.loanToken,
      'sell',
      'ZeroXSwap_MorphoBlueClosePosition_ComboMeal',
      'MorphoBlueClosePositionRecipe',
      'loan',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const {
      market,
      sellERC20Info,
      swapSlippageBasisPoints,
      repaySlippageBasisPoints,
      owner,
      provider,
    } = this.opts;

    const buyERC20Info = await morphoBlueLoanERC20Info(market, provider);

    return [
      new ZeroXV2SwapRecipe(
        sellERC20Info,
        buyERC20Info,
        swapSlippageBasisPoints,
        this.executor,
      ),
      new MorphoBlueClosePositionRecipe(
        market,
        repaySlippageBasisPoints,
        this.executor,
        provider,
        owner,
      ),
    ];
  }

  /**
   * Required. It is what points the close recipe's `< maxRepaidAssets` guard at
   * the guaranteed fill. Without it the guard compares against the expected buy
   * amount, passes, and the batch reaches chain with a repay budget the swap
   * never had to deliver.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
