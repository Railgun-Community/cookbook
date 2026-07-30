import { ComboMealConfig, RecipeERC20Info } from '../../models/export-models';
import { Recipe } from '../../recipes';
import { ZeroXV2SwapRecipe } from '../../recipes/swap/zero-x-v2-swap-recipe';
import {
  FxMintTopupRecipe,
  FxMintTopupRecipeOpts,
} from '../../recipes/borrow/fx/fx-mint-topup-recipe';
import { ComboMeal } from '../combo-meal';
import { MIN_GAS_LIMIT_COMBO_MEAL } from '../../models/min-gas-limits';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { assertSwapTokenIsNotCollateral, fxCollateralERC20Info } from './util';

export type ZeroXSwap_FxMintTopup_ComboMealOpts = FxMintTopupRecipeOpts & {
  /** Any ERC-20 to top up from. Swapped into the pool's collateral by the 0x leg. */
  sellERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  recipient: EphemeralExecutor | string;
};

/**
 * Top up an f(x) position from ANY token: swap into the pool's collateral, then
 * add it to an existing position — in one combo. Debt is unchanged.
 *
 * ```
 * private asset → 0x swap (→ pool collateral) → operate(+coll, 0) → shield NFT
 * ```
 *
 * The position NFT rides in `RecipeInput.nfts` of the FIRST recipe and transits
 * the seam untouched by the swap leg, arriving back at the user's `0zk` address.
 *
 * Conservative seam: `operate()` pulls an exact collateral amount from a
 * non-deterministic swap output, so the topup consumes the guaranteed `minBuy`
 * and any surplus reshields.
 */
export class ZeroXSwap_FxMintTopup_ComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: '0x Swap + f(x) Topup',
    description:
      'Swaps into the pool collateral and adds it to an existing f(x) position, long or short.',
    minGasLimit: MIN_GAS_LIMIT_COMBO_MEAL,
  };

  private readonly swapRecipe: ZeroXV2SwapRecipe;
  private readonly topupRecipe: FxMintTopupRecipe;

  constructor(opts: ZeroXSwap_FxMintTopup_ComboMealOpts) {
    super();
    const {
      sellERC20Info,
      swapSlippageBasisPoints,
      recipient,
      ...fxOpts
    } = opts;

    // See ZeroXSwap_FxMintOpen_ComboMeal: the executor binds the swap leg only;
    // operate() acts on msg.sender.
    const executor = resolveExecutorAddress(
      recipient,
      'ZeroXSwap_FxMintTopup_ComboMeal recipient',
    );

    const buyERC20Info = fxCollateralERC20Info(fxOpts.pool);
    assertSwapTokenIsNotCollateral(
      sellERC20Info,
      buyERC20Info,
      'sell',
      'ZeroXSwap_FxMintTopup_ComboMeal',
      'FxMintTopupRecipe',
    );

    this.swapRecipe = new ZeroXV2SwapRecipe(
      sellERC20Info,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor,
    );
    this.topupRecipe = new FxMintTopupRecipe(fxOpts);
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return [this.swapRecipe, this.topupRecipe];
  }

  protected conservativeSeamAmounts(): boolean {
    return true;
  }
}
