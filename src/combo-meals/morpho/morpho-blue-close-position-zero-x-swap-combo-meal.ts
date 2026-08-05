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
  morphoBlueCollateralERC20Info,
} from './util';

export type MorphoBlueClosePosition_ZeroXSwap_ComboMealOpts = {
  market: MarketParams;
  /** Any ERC-20 to exit into. The withdrawn collateral is swapped to this. */
  buyERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** Buffer on the shares→assets conversion, 1..10000 bps. Sizes the repay budget. */
  repaySlippageBasisPoints: bigint;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — whose position is closed. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
};

/**
 * Exit a Morpho Blue borrow position into ANY token: repay the whole debt by
 * shares with the unshielded loan token, withdraw all the collateral, then swap
 * that collateral into a desired asset — in one combo.
 *
 * ```
 * unshield loan token → repay(shares) → withdrawCollateral(all)
 *   → 0x swap (collateral → desired) → shield asset + unspent loan token
 * ```
 *
 * The mirror of `ZeroXSwap_MorphoBlueClosePosition_ComboMeal`: that one is for a
 * holder who does not have the loan token, this one is for a holder who does and
 * does not want the collateral back as collateral. The sell side is derived from
 * the market, so the swap can only ever sell what the close withdraws.
 *
 * Two outputs beyond the obvious one:
 *   - **unspent loan token.** The shares repay spends a conservative
 *     `maxRepaidAssets`; whatever interest drift did not consume rides the seam
 *     as a second ERC-20 the swap recipe does not handle, and the recipe
 *     engine's epilogue reshields it.
 *   - **no position handle.** Blue positions are un-tokenized, so unlike the
 *     f(x) analogue there is no NFT transiting the swap leg. A fully closed
 *     position is three zero words at `position[id][owner]`, indistinguishable
 *     from an account that never opened one.
 *
 * ## Failure shape
 *
 * The swap leg is sized from `getWithdrawAllCollateralQuote`, which reads the
 * owner's collateral when the combo builds. If the repay or the withdraw is
 * refused on chain, the collateral never reaches the executor and the 0x call
 * orders more than it holds — that reverts, `requireSuccess = false` swallows
 * it, and the batch mines with the unshielded loan token reshielded and the
 * position untouched. Wasteful, not lossy. The inverse — an over-declared
 * collateral amount — has the same shape, which is why this combo does not let
 * the caller name the sell amount.
 */
export class MorphoBlueClosePosition_ZeroXSwap_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'Morpho Blue Close Position + 0x Swap',
    description:
      'Closes a Morpho Blue position and swaps the withdrawn collateral into a desired asset.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly opts: MorphoBlueClosePosition_ZeroXSwap_ComboMealOpts;
  private readonly executor: string;

  constructor(opts: MorphoBlueClosePosition_ZeroXSwap_ComboMealOpts) {
    super();
    this.executor = resolveExecutorAddress(
      opts.executor,
      'MorphoBlueClosePosition_ZeroXSwap_ComboMeal executor',
    );
    assertMorphoBlueSwapTokenDiffers(
      opts.buyERC20Info,
      opts.market.collateralToken,
      'buy',
      'MorphoBlueClosePosition_ZeroXSwap_ComboMeal',
      'MorphoBlueClosePositionRecipe',
      'collateral',
    );
    this.opts = opts;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    const {
      market,
      buyERC20Info,
      swapSlippageBasisPoints,
      repaySlippageBasisPoints,
      owner,
      provider,
    } = this.opts;

    const sellERC20Info = await morphoBlueCollateralERC20Info(market, provider);

    return [
      new MorphoBlueClosePositionRecipe(
        market,
        repaySlippageBasisPoints,
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
   * A no-op today — `MorphoBlueWithdrawCollateralStep` declares
   * `minBalance === expectedBalance`, so the collateral crossing the seam has no
   * spread. Set deliberately: the downstream swap sells an EXACT amount, so this
   * is what would stop an underfill from reverting the batch the day the close
   * side gains a non-deterministic component. Do not remove it as dead
   * configuration.
   */
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
