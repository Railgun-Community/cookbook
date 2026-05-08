import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, ZeroXV2SwapStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput, SwapQuoteData } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import type { Address } from 'viem';
import {
  FX_ADDRESSES,
  resolvePool,
  type FxMintPoolRef,
  type FxMintPoolName,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintOpenPositionStep } from '../../../steps/borrow/fx/fx-mint-open-position-step';

export type FxMintOpenRecipeOpts = {
  pool: FxMintPoolRef;
  /** Absolute fxUSD debt to mint. */
  targetDebt: bigint;
  /** Predicted positionId from Pool.getNextPositionId(). Race-checked at gas-estimate. */
  predictedPositionId: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (see getFxPool in cookbook/src/api/borrow/fx — Task 13).
   * Was hardcoded 0.5% in v0; now dynamic to track f(x) governance changes.
   */
  borrowFeeRatio: bigint;
  /**
   * 0x v2 swap quote (input → collateralToken).
   *
   * Required iff the input asset doesn't match pool.collateralToken — i.e.,
   * wstETH-Long uses WETH input + WETH→wstETH swap. Forbidden for
   * WBTC-Long (which expects direct WBTC input — no swap). Custom pool
   * refs trust the caller's choice. See validatePoolFlow below.
   */
  swapQuote?: SwapQuoteData;
  /** Required iff swapQuote provided. */
  slippageBasisPoints?: number;
};

/**
 * Cookbook recipe: Open a new f(x) Long position.
 *
 * Two paths, branched on swapQuote presence:
 *
 *   swap path (wstETH-Long, WETH input):
 *     approve(0x AllowanceTarget, WETH) → swap(WETH → wstETH)
 *       → approve(PoolManager, wstETH) → operate(open)
 *
 *   direct path (WBTC-Long, WBTC input):
 *     approve(PoolManager, WBTC) → operate(open)
 *
 * Inputs (RecipeInput.erc20Amounts): WETH (swap path) or pool collateral
 * (direct path).
 * Outputs (shielded back): fxUSD + position NFT (predictedPositionId).
 *
 * The leading ApproveERC20SpenderStep on the swap path is required even
 * with `ZeroXV2SwapStep` because that step verifies, but does not grant,
 * the AllowanceTarget approval.
 *
 * Per-pool flow validation (validatePoolFlow):
 *   - wstETH-Long requires swapQuote (WETH → wstETH).
 *   - WBTC-Long forbids swapQuote (WBTC direct).
 *   - Custom pool refs are trusted (caller's choice via swapQuote).
 */
export class FxMintOpenRecipe extends Recipe {
  readonly id = "fxmint-open-v1";
  readonly config: RecipeConfig = {
    name: "fxMINT Open",
    description: "Open f(x) Long position; swap-path or direct-path based on pool.",
    minGasLimit: 1_500_000n,
  };

  constructor(private readonly opts: FxMintOpenRecipeOpts) {
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
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;

    const openStep = new FxMintOpenPositionStep({
      pool: pool.address,
      collateralToken: pool.collateralToken,
      collateralDecimals: pool.collateralDecimals,
      targetDebt: this.opts.targetDebt,
      predictedPositionId: this.opts.predictedPositionId,
      borrowFeeRatio: this.opts.borrowFeeRatio,
    });

    if (this.opts.swapQuote) {
      // Swap path: WETH (or any non-collateral input) → collateral via 0x.
      // Post-swap approve + operate use whatever collateral the swap actually
      // produces (non-deterministic by slippage). Cookbook rejects fixed
      // amounts on steps following a non-deterministic step, so the
      // approve/operate steps read input.expectedBalance at run time.
      const inputToken = FX_ADDRESSES.WETH as Address;
      return [
        new ApproveERC20SpenderStep(
          this.opts.swapQuote.spender,
          { tokenAddress: inputToken, decimals: 18n },
        ),
        new ZeroXV2SwapStep(
          this.opts.swapQuote,
          { tokenAddress: inputToken, decimals: 18n },
        ),
        new ApproveERC20SpenderStep(
          poolManager,
          { tokenAddress: pool.collateralToken, decimals: pool.collateralDecimals },
        ),
        openStep,
      ];
    }

    // Direct path: input asset already matches pool collateral; no swap leg.
    // The recipe input ERC20 is the pool collateral itself (e.g. WBTC),
    // so we just approve PoolManager and call operate().
    return [
      new ApproveERC20SpenderStep(
        poolManager,
        { tokenAddress: pool.collateralToken, decimals: pool.collateralDecimals },
      ),
      openStep,
    ];
  }
}

/**
 * Per-pool flow validation, factored out for reuse by FxMintCloseRecipe,
 * FxMintTopupRecipe, and FxMintTopupAndBorrowRecipe.
 *
 * v0.1 wstETH-Long REQUIRES swapQuote (WETH → wstETH).
 * v0.1 WBTC-Long FORBIDS swapQuote (WBTC direct only).
 * Custom pool refs are trusted — caller picks path via swapQuote presence.
 *
 * Errors are prefixed with `fxmint:` (not the specific recipe name) so
 * the same helper can be called from open/close/topup/topup-and-borrow
 * without lying about which recipe produced the error.
 */
export function validatePoolFlow(
  poolRef: FxMintPoolRef,
  swapQuote: SwapQuoteData | undefined,
): void {
  if (typeof poolRef !== 'string') return; // custom pool — trust caller

  const named: FxMintPoolName = poolRef;
  if (named === 'wstETH-Long' && !swapQuote) {
    throw new Error(
      'fxmint: swapQuote required for wstETH-Long (WETH → wstETH path)',
    );
  }
  if (named === 'WBTC-Long' && swapQuote) {
    throw new Error(
      'fxmint: WBTC-Long uses direct path; swapQuote must be omitted',
    );
  }
}
