import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueSupplyCollateralAndBorrowRecipe } from '../../recipes/morpho/blue-supply-collateral-and-borrow-recipe';
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
  morphoBlueCollateralERC20Info,
} from './util';

export type ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 to enter from. Swapped into the market's collateral token. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /**
   * Debt to draw, in loan-token native units. **Size this against the swap's
   * GUARANTEED fill** — see the class docs, and prefer `quoteMorphoBlueSwapOpen`
   * over computing it by hand.
   */
  borrowAssets: bigint;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf`. Defaults to the executor (self-custody). */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * Private Morpho Blue entry from ANY token: swap into the market's collateral,
 * supply it, and borrow the loan token against it — in one combo.
 *
 * ```
 * private asset → 0x swap (→ collateral token) → supplyCollateral → borrow
 *   → shield borrowed loan token
 * ```
 *
 * The buy side is derived from the market, never passed in, so a quote cannot
 * name a token `supplyCollateral` will not accept. If the input already IS the
 * collateral token, use `MorphoBlueSupplyCollateralAndBorrowRecipe` directly —
 * this combo throws rather than quoting a degenerate self-swap.
 *
 * ## The collateral leg self-sizes; the borrow leg does not
 *
 * This is the asymmetry that makes the combo hazardous to size by hand, and it
 * has no equivalent in the f(x) family (whose recipes take every amount as a
 * constructor argument).
 *
 * `MorphoBlueSupplyCollateralAndBorrowRecipe` reads the collateral amount out of
 * its own input, so with `conservativeSeamAmounts` the supply leg tracks the
 * swap's guaranteed fill automatically: it approves and supplies exactly
 * `minimumBuyAmount`, and a better-than-quoted fill reshields as surplus
 * collateral. Nothing can over-declare.
 *
 * `borrowAssets` is a fixed number the caller passes. It does **not** track the
 * fill. Size it against the expected buy amount and a merely-average fill leaves
 * the position with less collateral than the borrow assumed — Blue's health
 * check refuses, `RelayAdapt7702` runs with `requireSuccess = false`, and the
 * batch mines with status 1 having supplied the collateral and drawn no debt.
 * The collateral is recoverable (the wallet holds the executor key) but the
 * association between that address and the position is now public and permanent,
 * and the entry costs a second batch. `quoteMorphoBlueSwapOpen` sizes the borrow
 * against `minimumBuyAmount` and refuses to build otherwise.
 *
 * ## `owner` and `receiver`
 *
 * `owner` defaults to the executor. Passing it explicitly supplies collateral to
 * — and borrows against — a durable account, which requires that account to have
 * authorised the executor on Morpho (`getBorrowQuote` preflights it). Note the
 * asymmetry the recipe documents: the SUPPLY leg is ungated, so a wrong `owner`
 * hands the swapped collateral to that account irrecoverably, and no revert says
 * so.
 */
export class ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + Morpho Blue Supply Collateral + Borrow',
    description:
      'Swaps into the market collateral, supplies it, and borrows the loan token against it.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMealOpts;
  private readonly executor: string;

  constructor(
    opts: ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMealOpts,
  ) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal executor',
    );
    // Address-only, so it runs here rather than in getRecipes(): the caller
    // wants "you passed the wrong sell token" before any network I/O.
    assertMorphoBlueSwapTokenDiffers(
      opts.sellERC20Info,
      opts.market.collateralToken,
      'sell',
      'ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal',
      'MorphoBlueSupplyCollateralAndBorrowRecipe',
      'collateral',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const {
      market,
      sellERC20Info,
      swapSlippageBasisPoints,
      borrowAssets,
      owner,
      provider,
    } = this.opts;

    // Read here rather than in the constructor: a Blue market descriptor
    // carries no decimals, and a constructor cannot await.
    const buyERC20Info = await morphoBlueCollateralERC20Info(market, provider);

    return [
      new ZeroXV2SwapRecipe(
        sellERC20Info,
        buyERC20Info,
        swapSlippageBasisPoints,
        this.executor,
      ),
      new MorphoBlueSupplyCollateralAndBorrowRecipe(
        market,
        borrowAssets,
        this.executor,
        provider,
        owner,
      ),
    ];
  }

  /**
   * Required. `supplyCollateral` pulls an exact amount from the
   * non-deterministic swap output, so the seam must hand the Blue recipe the
   * guaranteed figure — the optimistic one over-declares the approve and the
   * supply on any below-expectation fill, silently, under
   * `requireSuccess = false`.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
