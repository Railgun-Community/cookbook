import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintOpenRecipe,
  FxMintOpenRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-open-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_ZEROX_FXMINT_OPEN_COMBO } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { assertSwapTokenIsNotCollateral, fxCollateralERC20Info } from './util';

export type ZeroXSwap_FxMintOpen_ComboMealOpts = FxMintOpenRecipeOpts & {
  /** Any ERC-20 to enter from. Swapped into the pool's collateral by the 0x leg. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  recipient: EphemeralExecutor | string;
};

/**
 * Private f(x) entry from ANY token: swap into the pool's collateral, then open
 * a Long position — in one combo.
 *
 * ```
 * private asset → 0x swap (→ pool collateral) → operate(open) → shield fxUSD + NFT
 * ```
 *
 * The buy side is derived from the pool, never passed in, so a quote can no
 * longer disagree with the collateral the position actually needs. If the input
 * already IS the pool collateral, use `FxMintOpenRecipe` directly — this combo
 * throws rather than quoting a degenerate self-swap.
 *
 * The swap's buy amount is non-deterministic (`[minBuy, expectedBuy]`) while
 * `operate()` pulls an EXACT collateral amount, so the seam runs in conservative
 * mode: the open consumes the guaranteed `minBuy` and any surplus from a
 * better-than-quoted fill reshields — the batch never reverts on an underfill.
 */
export class ZeroXSwap_FxMintOpen_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + f(x) Open Position',
    description:
      'Swaps into the pool collateral and opens an f(x) position, long or short (shields the borrowed debt token and the position NFT).',
    // Its OWN measured floor, not the generic combo one. Aggregation could not
    // rescue this: the generic 2_900_000 beat its dearest constituent
    // (FXMINT_OPEN, 2_690_000), so `max(...)` returned 2_900_000 while the
    // measured floor is 3_121_581. This is the §4.1 shape that ran out of gas
    // on mainnet at 3_016_590.
    minGasLimit: MIN_GAS_LIMIT_ZEROX_FXMINT_OPEN_COMBO,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly openRecipe: FxMintOpenRecipe;

  constructor(opts: ZeroXSwap_FxMintOpen_ComboMealOpts) {
    super();
    const {
      sellERC20Info,
      swapSlippageBasisPoints,
      recipient,
      ...fxOpts
    } = opts;

    // Validate once and thread the same address into the swap leg. The fx
    // recipe takes no executor: PoolManager.operate() mints the fxUSD and the
    // position NFT to msg.sender, which IS the executing account. (If a future
    // fx step adopts FX_POOL_ABI's unused 4-arg `operate(..., owner)` variant,
    // it must be handed this same executor.)
    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_FxMintOpen_ComboMeal recipient',
    );

    const buyERC20Info = fxCollateralERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      sellERC20Info,
      buyERC20Info,
      'sell',
      'ZeroXSwap_FxMintOpen_ComboMeal',
      'FxMintOpenRecipe',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.openRecipe = new FxMintOpenRecipe(fxOpts);
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.openRecipe];
  }

  // operate() pulls an exact amount from the non-deterministic swap output →
  // feed it the guaranteed minimum across the seam (surplus reshields).
  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
