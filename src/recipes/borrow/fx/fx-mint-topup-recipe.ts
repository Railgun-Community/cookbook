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

export type FxMintTopupRecipeOpts = {
  pool: FxMintPoolRef;
  /** Existing position to top up. */
  positionId: bigint;
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
 * Cookbook recipe: Top up collateral on an existing f(x) Long position
 * WITHOUT changing debt.
 *
 * Two paths, branched on swapQuote presence (mirrors open/close):
 *
 *   swap path (wstETH-Long, WETH input):
 *     approve(0x AllowanceTarget, WETH) → swap(WETH → wstETH)
 *       → approve(PoolManager, wstETH) → operate(positionId, +coll, 0)
 *
 *   direct path (WBTC-Long, WBTC input):
 *     approve(PoolManager, WBTC) → operate(positionId, +coll, 0)
 *
 * Inputs (RecipeInput): WETH (swap path) or pool collateral (direct), plus
 * the position NFT.
 * Outputs (shielded back): position NFT (same id; survives the topup —
 * adjust ops never change positionId, only full close burns).
 *
 * No fxUSD output — debt is unchanged. For "top up + borrow more in one
 * tx," use FxMintTopupAndBorrowRecipe (Task 10). For "borrow more without
 * adding collateral," use FxMintBorrowMoreRecipe (Task 11).
 *
 * Builds on FxMintAdjustPositionStep with collDelta > 0, debtDelta = 0n.
 * Since debtDelta = 0n the step does NOT require borrowFeeRatio /
 * repayFeeRatio (those are debt-axis only — see step-level guard).
 */
export class FxMintTopupRecipe extends Recipe {
  readonly id = 'fxmint-topup-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Topup',
    description: 'Add collateral to an f(x) Long position; debt unchanged.',
    minGasLimit: 1_500_000n,
  };

  constructor(private readonly opts: FxMintTopupRecipeOpts) {
    super();
    // Per-pool flow validation shared with open/close recipes — keeps the
    // 'fxmint:' error messages consistent across the recipe family.
    validatePoolFlow(opts.pool, opts.swapQuote, 'deposit');
    if (opts.swapQuote && opts.slippageBasisPoints === undefined) {
      throw new Error(
        'fxmint: slippageBasisPoints required when swapQuote provided',
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
    //     declares spentERC20Amounts using inputColl.expectedBalance,
    //     which is the QUOTED (not on-chain-actual) amount — cookbook's
    //     amount-accounting uses expected/min balance pairs precisely
    //     because the step layer can't know on-chain actual delivery.
    //     Mirrors FxMintOpenPositionStep.
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
          `FxMintTopupRecipe: no ${pool.collateralToken} in input.erc20Amounts (direct path requires collateral input)`,
        );
      }
      collDelta = collInput.expectedBalance;
    }

    // debtDelta = 0n — pure collateral top-up, no fxUSD mint or burn.
    // Step accepts (collDelta>0, debtDelta=0) without requiring borrowFee
    // /repayFee ratios; only operate(0,0) would revert.
    const adjustStep = new FxMintAdjustPositionStep({
      pool: pool.address,
      collateralToken: pool.collateralToken,
      collateralDecimals: pool.collateralDecimals,
      positionId: this.opts.positionId,
      collDelta,
      debtDelta: 0n,
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
    // leg. Approve PoolManager and call operate().
    return [
      new ApproveERC20SpenderStep(poolManager, {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
      }),
      adjustStep,
    ];
  }
}
