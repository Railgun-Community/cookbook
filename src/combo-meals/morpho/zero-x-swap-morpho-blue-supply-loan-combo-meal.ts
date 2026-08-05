import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueSupplyLoanRecipe } from '../../recipes/morpho/blue-supply-loan-recipe';
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

export type ZeroXSwap_MorphoBlueSupplyLoan_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 to lend from. Swapped into the market's LOAN token. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  executor: EphemeralExecutor | string;
  /**
   * Blue `onBehalf` — whose `supplyShares` grow. Defaults to the executor.
   *
   * Ungated, like repay: anyone may supply on anyone's behalf. So a wrong owner
   * here lends the swapped asset to a stranger and nothing reverts to say so.
   */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * Lend into a Morpho Blue market from ANY token: swap into the loan asset, then
 * supply it — in one combo.
 *
 * ```
 * private asset → 0x swap (→ loan token) → supply → shield nothing but change
 * ```
 *
 * The lend side had no path through the cookbook at all until
 * `MorphoBlueSupplyLoanRecipe`; this is what makes it reachable from an asset
 * the lender actually holds, which is the ordinary case — a market's loan token
 * is chosen by whoever created the market, not by the lender.
 *
 * The buy side is derived from the market. A supply is denominated only in the
 * loan token, so letting the caller name it would allow a quote for an asset
 * Blue will not accept.
 *
 * ## Nothing shields except change, and that is not a defect
 *
 * A supply claim is un-tokenized: it exists as `position[id][owner].supplyShares`
 * inside the Blue singleton, so there is no share token to shield. The batch's
 * only ERC-20 output is whatever the swap over-delivered. That has the same
 * consequence the supply step documents — a SUCCESSFUL supply followed by a
 * later failure leaves a claim the shield epilogue cannot sweep, recoverable
 * only by a second batch running as (or authorized by) `owner`, with the
 * address↔position link public from then on.
 *
 * Exiting is `MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal`, and it is bounded by
 * the market's FREE LIQUIDITY rather than by anything about this position — lent
 * assets are out on loan. Check that before lending into a market you may need
 * to leave quickly.
 */
export class ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + Morpho Blue Supply Loan Asset',
    description:
      'Swaps into the market loan token and lends it into a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: ZeroXSwap_MorphoBlueSupplyLoan_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: ZeroXSwap_MorphoBlueSupplyLoan_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.sellERC20Info,
      opts.market.loanToken,
      'sell',
      'ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal',
      'MorphoBlueSupplyLoanRecipe',
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
      new MorphoBlueSupplyLoanRecipe(market, owner ?? this.executor, provider),
    ];
  }

  /**
   * Required. `supply(assets)` pulls an exact amount and the approve before it
   * is exact-amount too, so an optimistically-sized seam makes Blue pull more
   * than the executor holds on any below-expectation fill. That reverts, is
   * swallowed by `requireSuccess = false`, and the batch mines having lent
   * nothing while still paying both RAILGUN fees.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
