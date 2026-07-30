import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  assertCollateralInput,
  resolvePool,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintAdjustPositionStep } from '../../../steps/borrow/fx/fx-mint-adjust-position-step';
import { MIN_GAS_LIMIT_FXMINT_ADJUST } from '../../../models/min-gas-limits';

export type FxMintTopupAndBorrowRecipeOpts = {
  pool: FxMintPoolRef;
  /** Existing position to lever-up. Same NFT in and out (operate adjusts state, doesn't reissue). */
  positionId: bigint;
  /**
   * Additional fxUSD to mint on top of the existing position debt.
   *
   * Must be > 0. To top up collateral WITHOUT minting more debt, use
   * FxMintTopupRecipe. To mint without adding collateral, use
   * FxMintBorrowMoreRecipe.
   */
  additionalDebt: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (see getFxPool in cookbook/src/api/borrow/fx).
   * Required because debtDelta > 0 by definition for this recipe.
   */
  borrowFeeRatio: bigint;
};

/**
 * Cookbook recipe: Top up collateral AND borrow additional fxUSD against the
 * (now-larger) position in a single PoolManager.operate() call.
 *
 *   approve(PoolManager, collateral) → operate(positionId, +coll, +debt)
 *
 * Inputs (RecipeInput): the pool's collateral token, plus the position NFT.
 * Outputs (shielded back): position NFT (same id) + fxUSD (post-borrow-fee net
 * = additionalDebt × (FEE_DENOM - borrowFeeRatio) / FEE_DENOM, declared by
 * FxMintAdjustPositionStep).
 *
 * **Single-protocol.** To lever up from any other asset, use
 * `ZeroXSwap_FxMintTopupAndBorrow_ComboMeal`.
 *
 * Semantically "lever-up" — increases both collateral AND exposure. The single
 * operate() call is what makes lever-up cheaper than topup + borrowMore
 * back-to-back: one rate-bound check, one storage write.
 *
 * Builds on FxMintAdjustPositionStep with collDelta > 0, debtDelta > 0.
 */
export class FxMintTopupAndBorrowRecipe extends Recipe {
  readonly id = 'fxmint-topup-and-borrow-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Topup + Borrow',
    description: 'Add collateral and mint additional fxUSD in one operate().',
    minGasLimit: MIN_GAS_LIMIT_FXMINT_ADJUST,
  };

  constructor(private readonly opts: FxMintTopupAndBorrowRecipeOpts) {
    super();
    // additionalDebt > 0 is the definitional constraint: this recipe exists for
    // the lever-up case. 0n debtDelta would route through FxMintTopupRecipe;
    // < 0 would burn fxUSD, which is the repay axis (FxMintRepayDebtRecipe /
    // FxMintCloseRecipe). Catching here gives a clear error vs. a confusing
    // low-level mismatch later.
    if (opts.additionalDebt <= 0n) {
      throw new Error(
        'fxmint: FxMintTopupAndBorrowRecipe.additionalDebt must be > 0; use FxMintTopupRecipe for collateral-only top-up',
      );
    }
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    const collInput = assertCollateralInput(pool, first.erc20Amounts);

    // Both deltas non-zero: collDelta > 0 (collateral added), debtDelta > 0
    // (fxUSD minted). The step requires borrowFeeRatio when debtDelta > 0 so it
    // can declare the post-fee fxUSD output. We do NOT pass repayFeeRatio
    // because debtDelta is positive (mint, not burn).
    return [
      new ApproveERC20SpenderStep(pool.poolManager, {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
      }),
      new FxMintAdjustPositionStep({
        pool,
        positionId: this.opts.positionId,
        collDelta: collInput.expectedBalance,
        debtDelta: this.opts.additionalDebt,
        borrowFeeRatio: this.opts.borrowFeeRatio,
      }),
    ];
  }
}
