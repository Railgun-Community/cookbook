import { Provider } from 'ethers';
import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import { MorphoBlueWithdrawLoanRecipe } from '../../recipes/morpho/blue-withdraw-loan-recipe';
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

export type MorphoBlueWithdrawLoan_ZeroXSwap_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 to exit into. The withdrawn loan asset is swapped to this. */
  buyERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — whose supply claim shrinks. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
  /**
   * Assets to withdraw. Omit for a full exit, which switches the quote to
   * SHARES — the only correct denomination for "withdraw everything", because a
   * supply claim grows with borrower interest between build and inclusion.
   */
  withdrawAssets?: bigint;
};

/**
 * Exit a Morpho Blue lend position into ANY token: withdraw the lent loan asset,
 * then swap it into a desired asset — in one combo.
 *
 * ```
 * withdraw (assets or all-by-shares) → 0x swap (loan token → desired)
 *   → shield asset
 * ```
 *
 * Unshields nothing: the position is already inside Blue, so the batch opens
 * with the withdrawal and the shield epilogue sweeps what the swap produced.
 *
 * The sell side is derived from the market, never passed in — the swap can only
 * ever sell what the withdrawal actually releases.
 *
 * ## What refuses this is liquidity, not health
 *
 * Lent assets are out on loan. Blue reverts `InsufficientLiquidity` when
 * `totalSupplyAssets - totalBorrowAssets` is below the withdrawal, so a fully
 * utilized market locks a lender out entirely however large their claim — the
 * exact opposite of the collateral side, where only a health check applies.
 * `MorphoBlueAPI.getWithdrawLoanQuote` checks it at build time and its error
 * names the free liquidity, because on chain that revert is swallowed by
 * `requireSuccess = false` and the batch mines having done nothing. A partial
 * withdrawal up to the free liquidity is the workaround.
 *
 * Measured on mainnet head, 2026-08-05 (wstETH/USDC 86 %, `0xb32349…86cc`):
 * the boundary is exact, not approximate. `withdraw(free)` was accepted and
 * `withdraw(free + 1)` reverted `insufficient liquidity` — which is why the
 * builder compares with `>` and does not de-rate. Free liquidity also needs no
 * interest accrual before the comparison: `_accrueInterest` adds the same
 * interest to both totals, so their difference does not move.
 *
 * ## Seam
 *
 * A shares-mode withdrawal realises MORE than the step declares, never less
 * (interest only accrues upward), and an assets-mode one is exact. Either way
 * the swap sells a figure the executor is guaranteed to hold, and any excess
 * reshields as loan token.
 */
export class MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'Morpho Blue Withdraw Loan Asset + 0x Swap',
    description:
      'Withdraws lent loan asset from a Morpho Blue market and swaps it into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: MorphoBlueWithdrawLoan_ZeroXSwap_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: MorphoBlueWithdrawLoan_ZeroXSwap_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.buyERC20Info,
      opts.market.loanToken,
      'buy',
      'MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal',
      'MorphoBlueWithdrawLoanRecipe',
      'loan',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const {
      market,
      buyERC20Info,
      swapSlippageBasisPoints,
      owner,
      provider,
      withdrawAssets,
    } = this.opts;

    const sellERC20Info = await morphoBlueLoanERC20Info(market, provider);

    return [
      new MorphoBlueWithdrawLoanRecipe({
        market,
        owner: owner ?? this.executor,
        receiver: this.executor,
        provider,
        withdrawAssets,
      }),
      new ZeroXV2SwapRecipe(
        sellERC20Info,
        buyERC20Info,
        swapSlippageBasisPoints,
        this.executor,
      ),
    ];
  }

  /**
   * A no-op today — `MorphoBlueWithdrawLoanStep` declares
   * `minBalance === expectedBalance` on both denominations, so the seam has no
   * spread to be conservative about.
   *
   * Set deliberately, not accidentally. The downstream swap sells an EXACT
   * amount, so the day the withdraw side declares a real `[min, expected]` range
   * — a shares-mode quote that admits its downward uncertainty, say — this flag
   * is what stops the batch ordering more than the executor holds. Do not
   * "clean it up" as dead configuration.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
