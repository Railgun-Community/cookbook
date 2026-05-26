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
import { FxMintAdjustPositionStep } from '../../../steps/borrow/fx/fx-mint-adjust-position-step';
import { validatePoolFlow } from './fx-mint-open-recipe';

export type FxMintTopupAndBorrowRecipeOpts = {
  pool: FxMintPoolRef;
  /** Existing position to lever-up. Same NFT in and out (operate adjusts state, doesn't reissue). */
  positionId: bigint;
  /**
   * Additional fxUSD to mint on top of the existing position debt.
   *
   * Must be > 0. If you want to top up collateral WITHOUT minting more
   * debt, use FxMintTopupRecipe (Task 9). If you want to mint without
   * adding collateral, use FxMintBorrowMoreRecipe (Task 11).
   */
  additionalDebt: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (see getFxPool in cookbook/src/api/borrow/fx — Task 13).
   * Required because debtDelta > 0 by definition for this recipe.
   */
  borrowFeeRatio: bigint;
  /**
   * 0x v2 swap quote (input → collateralToken).
   *
   * Required iff input asset doesn't match pool.collateralToken
   * (wstETH-Long with WETH input). Forbidden for WBTC-Long.
   * Custom pool refs are trusted via validatePoolFlow.
   */
  swapQuote?: SwapQuoteData;
  /** Required iff swapQuote provided. */
  slippageBasisPoints?: number;
};

/**
 * Cookbook recipe: Top up collateral AND borrow additional fxUSD against
 * the (now-larger) position in a single PoolManager.operate() call.
 *
 * Two paths, branched on swapQuote presence (mirrors open/close/topup):
 *
 *   swap path (wstETH-Long, WETH input):
 *     approve(0x AllowanceTarget, WETH) → swap(WETH → wstETH)
 *       → approve(PoolManager, wstETH) → operate(positionId, +coll, +debt)
 *
 *   direct path (WBTC-Long, WBTC input):
 *     approve(PoolManager, WBTC) → operate(positionId, +coll, +debt)
 *
 * Inputs (RecipeInput): WETH (swap path) or pool collateral (direct), plus
 * the position NFT.
 * Outputs (shielded back): position NFT (same id) + fxUSD (post-borrow-fee
 * net = additionalDebt × (FEE_DENOM - borrowFeeRatio) / FEE_DENOM, declared
 * by FxMintAdjustPositionStep).
 *
 * Semantically "lever-up" — increases both collateral AND exposure. For
 * "top up, keep debt unchanged," use FxMintTopupRecipe. For "borrow more
 * without adding collateral," use FxMintBorrowMoreRecipe. The single
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
    minGasLimit: 1_500_000n,
  };

  constructor(private readonly opts: FxMintTopupAndBorrowRecipeOpts) {
    super();
    // Per-pool flow validation shared with open/close/topup recipes — keeps
    // the 'fxmint:' error messages consistent across the recipe family.
    validatePoolFlow(opts.pool, opts.swapQuote);
    if (opts.swapQuote && opts.slippageBasisPoints === undefined) {
      throw new Error(
        'fxmint: slippageBasisPoints required when swapQuote provided',
      );
    }
    // additionalDebt > 0 is the definitional constraint: this recipe
    // exists for the lever-up case. 0n debtDelta would route through
    // FxMintTopupRecipe; <0 would burn fxUSD which is the repay axis
    // (FxMintRepayDebtRecipe / FxMintCloseRecipe). Catching here gives
    // a clear error vs. a confusing low-level mismatch later.
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
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;

    // Determine collDelta for the adjust step:
    //
    //   swap path: encode from the 0x quote's promised buy amount.
    //     The actual collateral arriving at the adjust step is
    //     non-deterministic (slippage) — but FxMintAdjustPositionStep
    //     declares spentERC20Amounts using inputColl.expectedBalance, so
    //     accounting tracks the true amount even though `collDelta` here
    //     is the optimistic quoted amount. Mirrors FxMintTopupRecipe.
    //
    //   direct path: read from RecipeInput.erc20Amounts — the caller's
    //     input collateral is what gets deposited as-is. `first` is the
    //     StepInput passed by the recipe engine (Recipe.getRecipeOutput
    //     calls getInternalSteps with the initial step input populated
    //     from RecipeInput), so first.erc20Amounts has the input balances.
    let collDelta: bigint;
    if (this.opts.swapQuote) {
      collDelta = this.opts.swapQuote.buyERC20Amount.amount;
    } else {
      const collInput = first.erc20Amounts.find(
        a =>
          a.tokenAddress.toLowerCase() === pool.collateralToken.toLowerCase(),
      );
      if (!collInput) {
        // Direct path needs the pool collateral in RecipeInput. Throwing
        // here gives a clear error if the caller forgot to include it
        // (vs. a confusing low-level revert at gas-estimate time).
        throw new Error(
          `fxmint: FxMintTopupAndBorrowRecipe — no ${pool.collateralToken} in input.erc20Amounts (direct path requires collateral input)`,
        );
      }
      collDelta = collInput.expectedBalance;
    }

    // Both deltas non-zero: collDelta > 0 (collateral added), debtDelta > 0
    // (fxUSD minted). Step requires borrowFeeRatio when debtDelta > 0 so
    // it can declare the post-fee fxUSD output amount. We do NOT pass
    // repayFeeRatio because debtDelta is positive (mint, not burn).
    const adjustStep = new FxMintAdjustPositionStep({
      pool: pool.address,
      collateralToken: pool.collateralToken,
      collateralDecimals: pool.collateralDecimals,
      positionId: this.opts.positionId,
      collDelta,
      debtDelta: this.opts.additionalDebt,
      borrowFeeRatio: this.opts.borrowFeeRatio,
    });

    if (this.opts.swapQuote) {
      // Swap path: WETH input → 0x swap → wstETH → PoolManager.operate.
      // Leading approve(0x AllowanceTarget) is required even with
      // ZeroXV2SwapStep (which verifies but does not grant the approval).
      const inputToken = FX_ADDRESSES.WETH as Address;
      return [
        new ApproveERC20SpenderStep(this.opts.swapQuote.spender, {
          tokenAddress: inputToken,
          decimals: 18n,
        }),
        new ZeroXV2SwapStep(this.opts.swapQuote, {
          tokenAddress: inputToken,
          decimals: 18n,
        }),
        // Post-swap approve + operate consume whatever the swap produced
        // (non-deterministic by slippage); cookbook rejects fixed amounts
        // on steps following a non-deterministic step, so we omit the
        // explicit amount on the approve and let it use expectedBalance.
        new ApproveERC20SpenderStep(poolManager, {
          tokenAddress: pool.collateralToken,
          decimals: pool.collateralDecimals,
        }),
        adjustStep,
      ];
    }

    // Direct path: input asset already matches pool collateral; no swap
    // leg. Approve PoolManager and call operate() with both deltas.
    return [
      new ApproveERC20SpenderStep(poolManager, {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
      }),
      adjustStep,
    ];
  }
}
