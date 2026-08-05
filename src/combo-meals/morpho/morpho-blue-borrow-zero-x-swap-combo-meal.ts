import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueBorrowRecipe } from '../../recipes/morpho/blue-borrow-recipe';
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

export type MorphoBlueBorrow_ZeroXSwap_ComboMealOpts = {
  market: MarketParams;
  /** Debt to draw, loan-token native units. */
  borrowAssets: bigint;
  /** Any ERC-20 to receive. The borrowed loan token is swapped into this. */
  buyERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — the account the debt is booked against. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * Draw debt against an existing Morpho Blue position and receive ANY token:
 * borrow the loan token, then swap it into a desired asset — in one combo.
 *
 * ```
 * borrow → 0x swap (loan token → desired) → shield asset
 * ```
 *
 * Unshields nothing — the collateral is already inside Blue, supplied by an
 * earlier `execute()` batch as the same executor (or by the durable `owner`).
 * That non-atomic reuse is the whole point of a persistent 7702 account, and it
 * is what makes this combo distinct from the entry combo rather than a subset of
 * it.
 *
 * The privacy argument is the reason to prefer it over borrow-then-shield-then-
 * swap-later: a market's loan token is chosen by whoever created the market, so
 * a borrower who wants something else would otherwise shield the loan token
 * first and reveal, in a second public batch, that the two assets belong to the
 * same holder.
 *
 * ## Nothing here checks the borrow is affordable
 *
 * `MorphoBlueAPI.getBorrowQuote` preflights AUTHORIZATION and nothing else. It
 * does not check the LLTV, and it does not check that the market has the
 * liquidity. Both of those revert inside Blue, and both are swallowed by
 * `requireSuccess = false` — the batch mines with no debt drawn, and then the 0x
 * call tries to sell loan tokens the executor never received and reverts too.
 * Net cost is both RAILGUN fees and the gas, with nothing to show for it.
 *
 * Size the borrow with `morphoBlueBorrowCeiling` against a
 * `MorphoBlueAPI.getPositionRisks` read, exactly as `quoteMorphoBlueSwapOpen`
 * does — including its measured one-unit de-rate, which applies to any position
 * carrying no prior debt.
 */
export class MorphoBlueBorrow_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'Morpho Blue Borrow + 0x Swap',
    description:
      'Borrows against an existing Morpho Blue position and swaps the borrowed loan token into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: MorphoBlueBorrow_ZeroXSwap_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: MorphoBlueBorrow_ZeroXSwap_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'MorphoBlueBorrow_ZeroXSwap_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.buyERC20Info,
      opts.market.loanToken,
      'buy',
      'MorphoBlueBorrow_ZeroXSwap_ComboMeal',
      'MorphoBlueBorrowRecipe',
      'loan',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const {
      market,
      borrowAssets,
      buyERC20Info,
      swapSlippageBasisPoints,
      owner,
      provider,
    } = this.opts;

    const sellERC20Info = await morphoBlueLoanERC20Info(market, provider);

    return [
      new MorphoBlueBorrowRecipe(
        market,
        borrowAssets,
        this.executor,
        provider,
        owner,
      ),
      new ZeroXV2SwapRecipe(
        sellERC20Info,
        buyERC20Info,
        swapSlippageBasisPoints,
        this.executor,
      ),
    ];
  }

  /**
   * A no-op today — `MorphoBlueBorrowStep` declares
   * `minBalance === expectedBalance`, because `borrow(assets)` delivers exactly
   * the requested amount: a market's `fee` is taken out of accrued interest, not
   * out of principal. Set deliberately for the same reason as the other exit
   * combos: the downstream swap sells an EXACT amount.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
