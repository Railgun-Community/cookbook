import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintBorrowMoreRecipe,
  FxMintBorrowMoreRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-borrow-more-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import {
  assertSwapTokenIsNotCollateral,
  fxBorrowSwapSeamAmount,
  fxDebtERC20Info,
} from './util';

export type FxMintBorrowMore_ZeroXSwap_ComboMealOpts =
  FxMintBorrowMoreRecipeOpts & {
    /**
     * Any ERC-20 to take the borrowing in. The freshly minted debt token is
     * swapped into this by the 0x leg.
     */
    buyERC20Info: RecipeERC20Info;
    swapSlippageBasisPoints: number;
    /** The EIP-7702 ephemeral EOA the batch executes as. */
    recipient: EphemeralExecutor | string;
  };

/**
 * Borrow against an existing f(x) position and take the proceeds in ANY token —
 * in one combo.
 *
 * ```
 * unshield NFT → operate(positionId, 0, +additionalDebt)
 *   → 0x swap (debt token → desired) → shield asset + NFT
 * ```
 *
 * The mirror of {@link FxMintClose_ZeroXSwap_ComboMeal}: that one sells the
 * withdrawn COLLATERAL, this one sells the borrowed DEBT. Both derive the sell
 * side from the pool, so the swap can only ever sell what the position leg
 * actually produces.
 *
 * **Why the combo rather than borrow-then-swap.** `FxMintBorrowMoreRecipe`
 * leaves fxUSD (long) or wstETH/WBTC (short) shielded, which is the wrong asset
 * for a holder who borrowed in order to spend. Doing the swap afterwards means a
 * second unshield of a token whose amount and timing are both derivable from the
 * borrow — the exact linkage the shielded pool exists to break.
 *
 * **The swap sells the post-fee NET, and getting that wrong is the sharp edge.**
 * A long charges 0.5% on the borrow: `operate(pool, 1912, 0, +1e18)` on
 * `wstETH-Long` minted 0.995 fxUSD to the caller and 0.005 to f(x)'s fee
 * recipient (mainnet `0x09a3bd9d…`, block 25078146). An order for
 * `additionalDebt` would move 0.5% more than exists, 0x's `transferFrom` would
 * revert, and under `requireSuccess = false` the batch mines anyway — full gas,
 * nothing swapped, and the position now publicly linked to the executor.
 * `FxMintAdjustPositionStep` declares the net (`fxDebtBorrowOutput`), so the
 * seam hands the swap the right figure; {@link debtTokenToSell} exposes it.
 *
 * This is the only fx combo whose input carries **no ERC-20** — the position NFT
 * enters alone, so nothing pays a RAILGUN unshield fee on the way in.
 *
 * The whole borrowing is sold: `ZeroXV2SwapRecipe` sells its full seam balance.
 * To keep part of it in the debt token, borrow less here, or run
 * `FxMintBorrowMoreRecipe` and swap separately.
 *
 * Buying back the pool's own collateral is allowed and is a deliberate lever-up
 * — but the bought collateral SHIELDS, it is not re-deposited. Redepositing is a
 * second batch, or `ZeroXSwap_FxMintTopupAndBorrow_ComboMeal` from the start.
 */
export class FxMintBorrowMore_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'f(x) Borrow More + 0x Swap',
    description:
      'Mints additional debt against an existing f(x) position, long or short, and swaps it into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  /**
   * What the 0x leg will be asked to sell — `additionalDebt` net of f(x)'s
   * borrow fee, not `additionalDebt`. Exposed because the difference is
   * invisible from the constructor arguments and a caller comparing against an
   * independent quote will otherwise be off by the fee.
   */
  readonly debtTokenToSell: bigint;

  private readonly borrowRecipe: FxMintBorrowMoreRecipe;
  private readonly swapRecipe: ZeroXV2SwapRecipe;

  constructor(opts: FxMintBorrowMore_ZeroXSwap_ComboMealOpts) {
    super();
    const { buyERC20Info, swapSlippageBasisPoints, recipient, ...fxOpts } =
      opts;

    // Validate once and thread the same address into the swap leg. The fx
    // recipe takes no executor: PoolManager.operate() mints to msg.sender,
    // which IS the executing account.
    const executor = resolveExecutorAddress(
      recipient,
      'FxMintBorrowMore_ZeroXSwap_ComboMeal recipient',
    );

    const sellERC20Info = fxDebtERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      buyERC20Info,
      sellERC20Info,
      'buy',
      'FxMintBorrowMore_ZeroXSwap_ComboMeal',
      'FxMintBorrowMoreRecipe',
      'debt',
    );

    // Construct the fx recipe first: its constructor is what rejects
    // `additionalDebt <= 0`, and the seam arithmetic below is only meaningful
    // on a validated amount. Execution order is set by getRecipes(), not here.
    this.borrowRecipe = new FxMintBorrowMoreRecipe(fxOpts);
    this.debtTokenToSell = fxBorrowSwapSeamAmount(
      fxOpts.additionalDebt,
      fxOpts.borrowFeeRatio,
      'FxMintBorrowMore_ZeroXSwap_ComboMeal',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.borrowRecipe, this.swapRecipe];
  }

  /**
   * A no-op today — and for a *different* reason than on
   * {@link FxMintClose_ZeroXSwap_ComboMeal}, which is worth stating because the
   * two read identically and only one of them is structurally guaranteed.
   *
   * The seam carries exactly one token, the borrowed debt, and
   * `FxMintAdjustPositionStep` declares it `minBalance === expectedBalance ===
   * fxDebtBorrowOutput(additionalDebt, borrowFeeRatio)`. There is no spread for
   * the flag to narrow. But that determinism is arithmetic over two caller-
   * supplied constants, not a protocol guarantee: it holds exactly as long as
   * `borrowFeeRatio` still matches chain state at broadcast. f(x) governance can
   * rotate that ratio per (pool, operator), and a ratio that ROSE since the read
   * mints less than declared — at which point the swap orders more than the
   * executor holds and reverts silently.
   *
   * No seam flag defends that, because `minBalance` and `expectedBalance` are
   * wrong together. The defence is to read `borrowFeeRatio` from `getFxPool` in
   * the same flow that broadcasts.
   *
   * Left `true` deliberately: the downstream swap sells an EXACT amount, so the
   * day the borrow side gains a non-deterministic component this flag is what
   * keeps the order inside the guaranteed balance. Do not remove it as dead
   * configuration.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
