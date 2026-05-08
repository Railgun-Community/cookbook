import { Recipe } from '../../recipe';
import { Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { resolvePool, type FxMintPoolRef } from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintAdjustPositionStep } from '../../../steps/borrow/fx/fx-mint-adjust-position-step';

export type FxMintBorrowMoreRecipeOpts = {
  pool: FxMintPoolRef;
  /** Existing position to mint additional debt against. */
  positionId: bigint;
  /**
   * Additional fxUSD to mint, in 18-decimal units. Must be > 0 (a zero or
   * negative call would either no-op via PoolManager.operate(positionId,
   * 0, 0) — which reverts — or be misused by callers expecting a repay).
   * Use FxMintRepayDebtRecipe (Task 12) for repay; use FxMintTopupRecipe
   * (Task 9) for collateral-only adds.
   */
  additionalDebt: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (see getFxPool in cookbook/src/api/borrow/fx — Task 13).
   * Required because debtDelta > 0 by definition for this recipe.
   */
  borrowFeeRatio: bigint;
};

/**
 * Cookbook recipe: Mint additional fxUSD against an existing f(x) Long
 * position WITHOUT adding collateral.
 *
 *   operate(positionId, 0, +additionalDebt)
 *
 * Inputs (RecipeInput): position NFT only — no ERC-20 input. The relay-
 * adapter doesn't need to approve anything on the collateral side because
 * no collateral moves; PoolManager mints fxUSD directly to msg.sender
 * (the relay-adapter), which then shields it back to the user.
 *
 * Outputs (shielded back): position NFT (same id; adjust ops never
 * change positionId — only full close burns) + fxUSD (post-borrow-fee
 * net amount; the step accounts for the fee in its outputERC20Amounts).
 *
 * Pool-agnostic by design:
 *   - No swap leg (no input ERC-20 needs converting).
 *   - No collateral movement, so no PoolManager approve.
 *   - No call to validatePoolFlow — that helper enforces collateral-axis
 *     rules (wstETH-Long needs WETH→wstETH swap, WBTC-Long is direct),
 *     which don't apply to debt-only recipes. Single-step recipe.
 *
 * Use case: position has appreciated, user wants to extract more fxUSD
 * without adding fresh collateral. This INCREASES the position's debt
 * ratio — caller should sanity-check against the pool's
 * liquidationDebtRatio before constructing the recipe (see getFxPool,
 * Task 13). The on-chain operate() will revert if the new ratio crosses
 * the liquidation threshold, but failing client-side is friendlier.
 */
export class FxMintBorrowMoreRecipe extends Recipe {
  readonly id = "fxmint-borrow-more-v1";
  readonly config: RecipeConfig = {
    name: "fxMINT Borrow More",
    description: "Mint additional fxUSD against an existing f(x) Long position.",
    // Single-step recipe — operate() with debt-only delta is the lightest
    // adjust op, but we keep a 1M floor so wstETH oracle calls + price
    // fallback paths fit comfortably under the relay-adapter gas cap.
    minGasLimit: 1_000_000n,
  };

  constructor(private readonly opts: FxMintBorrowMoreRecipeOpts) {
    super();
    // Guard at construction time so callers see the misuse before
    // gas-estimate / dry-run. The step-level guard would also catch
    // (collDelta=0, debtDelta=0), but we want a recipe-specific message
    // and we want to reject debtDelta <= 0 explicitly (the step accepts
    // negative debtDelta as a repay — wrong recipe for that).
    if (opts.additionalDebt <= 0n) {
      throw new Error(
        'fxmint: FxMintBorrowMoreRecipe — additionalDebt must be > 0',
      );
    }
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(_first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    // Single AdjustStep: collDelta=0n, debtDelta=+additionalDebt.
    // No leading approve — the relay-adapter neither sends nor pulls
    // collateral here; it just calls PoolManager.operate which mints
    // fxUSD to msg.sender (the relay-adapter itself).
    return [
      new FxMintAdjustPositionStep({
        pool: pool.address,
        collateralToken: pool.collateralToken,
        collateralDecimals: pool.collateralDecimals,
        positionId: this.opts.positionId,
        collDelta: 0n,
        debtDelta: this.opts.additionalDebt,
        borrowFeeRatio: this.opts.borrowFeeRatio,
      }),
    ];
  }
}
