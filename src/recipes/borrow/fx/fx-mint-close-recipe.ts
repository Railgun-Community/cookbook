import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, ZeroXV2SwapStep, Step } from '../../../steps';
import type {
  RecipeConfig,
  StepInput,
  SwapQuoteData,
} from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  FX_ADDRESSES,
  resolvePool,
  type Address,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintClosePositionStep } from '../../../steps/borrow/fx/fx-mint-close-position-step';
import { validatePoolFlow } from './fx-mint-open-recipe';

export type FxMintCloseRecipeOpts = {
  pool: FxMintPoolRef;
  positionId: bigint;
  /** Debt reduction in fxUSD wei (pre-computed via computeFxClose). */
  repayAmount: bigint;
  /** Collateral withdrawal in native units (pre-computed via computeFxClose). */
  withdrawColl: bigint;
  /** = repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM. Pre-computed via computeFxClose. */
  approveAmount: bigint;
  /** True if position survives the close (caller's computeFxClose result). */
  partialClose: boolean;
  /**
   * 0x v2 swap quote (collateralToken → WETH).
   *
   * Required iff the user wants WETH output — wstETH-Long convention.
   * Forbidden for WBTC-Long, which shields the collateral directly back
   * to the user (WBTC out, no swap leg). Custom pool refs trust the
   * caller's choice. See validatePoolFlow in fx-mint-open-recipe.
   */
  swapQuote?: SwapQuoteData;
  /** Required iff swapQuote provided. */
  slippageBasisPoints?: number;
};

/**
 * Cookbook recipe: Close (or partially close) an f(x) Long position.
 *
 * Two paths, branched on swapQuote presence:
 *
 *   swap path (wstETH-Long, WETH out):
 *     approve(PoolManager, fxUSD) → operate(close)
 *       → approve(0x AllowanceTarget, wstETH) → swap(wstETH → WETH)
 *
 *   direct path (WBTC-Long, WBTC out):
 *     approve(PoolManager, fxUSD) → operate(close)
 *
 * Inputs (RecipeInput): fxUSD (the unshielded balance) + the position NFT.
 * Outputs (shielded back): WETH (swap path) or pool collateral (direct
 * path) + (if partial close) the position NFT.
 *
 * Convention-wise the v0.1 pairings invert symmetrically vs. open:
 * WBTC-Long close → WBTC out (direct); wstETH-Long close → WETH out (swap).
 *
 * `computeFxClose` is unchanged on the close-side math — f(x) has no
 * withdraw fee, so `withdrawColl` stays a clean ratio.
 */
export class FxMintCloseRecipe extends Recipe {
  readonly id = 'fxmint-close-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Close',
    description:
      'Close f(x) Long position; swap-path or direct-path based on pool.',
    minGasLimit: 2_500_000n,
  };

  constructor(private readonly opts: FxMintCloseRecipeOpts) {
    super();
    validatePoolFlow(opts.pool, opts.swapQuote);
    if (opts.swapQuote && opts.slippageBasisPoints === undefined) {
      throw new Error(
        'fxmint: slippageBasisPoints required when swapQuote provided',
      );
    }
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(_first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);
    const fxUSD = FX_ADDRESSES.fxUSD as Address;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;

    const closeStep = new FxMintClosePositionStep({
      pool: pool.address,
      collateralToken: pool.collateralToken,
      collateralDecimals: pool.collateralDecimals,
      positionId: this.opts.positionId,
      repayAmount: this.opts.repayAmount,
      withdrawColl: this.opts.withdrawColl,
      partialClose: this.opts.partialClose,
    });

    const approveFxUSD = new ApproveERC20SpenderStep(
      poolManager,
      { tokenAddress: fxUSD, decimals: 18n },
      this.opts.approveAmount,
    );

    if (this.opts.swapQuote) {
      // Swap path: collateral lands in relay-adapter, swapped to WETH.
      // Decimals on the post-close approve + swap step come from the pool
      // registry (wstETH = 18, hypothetical 8-decimal swap-path collateral
      // would be plumbed correctly) — pre-Task-8 these were hardcoded 18n,
      // which would silently mis-account a non-18-decimal swap collateral.
      return [
        approveFxUSD,
        closeStep,
        new ApproveERC20SpenderStep(
          this.opts.swapQuote.spender,
          {
            tokenAddress: pool.collateralToken,
            decimals: pool.collateralDecimals,
          },
          this.opts.withdrawColl,
        ),
        new ZeroXV2SwapStep(this.opts.swapQuote, {
          tokenAddress: pool.collateralToken,
          decimals: pool.collateralDecimals,
        }),
      ];
    }

    // Direct path: collateral shields back to user as-is (WBTC-Long).
    // No post-close approve / swap leg — the relay-adapter just holds the
    // pool collateral and Railgun shields it back into the user's account.
    return [approveFxUSD, closeStep];
  }
}
