import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  resolvePool,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintClosePositionStep } from '../../../steps/borrow/fx/fx-mint-close-position-step';
import { MIN_GAS_LIMIT_FXMINT_CLOSE } from '../../../models/min-gas-limits';

export type FxMintCloseRecipeOpts = {
  pool: FxMintPoolRef;
  positionId: bigint;
  /**
   * Debt reduction in `pool.debtToken` native units (pre-computed via
   * computeFxClose) — fxUSD for a long, wstETH/WBTC for a short.
   */
  repayAmount: bigint;
  /** Collateral withdrawal in native units (pre-computed via computeFxClose). */
  withdrawColl: bigint;
  /** = repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM. Pre-computed via computeFxClose. */
  approveAmount: bigint;
  /**
   * f(x)'s withdraw fee for this (pool, operator), 1e9-denominated, from
   * `getFxPool(...).withdrawFeeRatio`.
   *
   * **Required.** `0n` on the long pools, `1_000_000n` (0.1%) on the shorts. If
   * you spread `computeFxClose`'s result into these options, this arrives with
   * it and there is nothing to add.
   */
  withdrawFeeRatio: bigint;
  /** True if position survives the close (caller's computeFxClose result). */
  partialClose: boolean;
};

/**
 * Cookbook recipe: Close (or partially close) an f(x) position, long or short.
 *
 *   approve(PoolManager, debtToken) → operate(close)
 *
 * Inputs (RecipeInput): the pool's debt token (the unshielded balance) + the
 * position NFT. Outputs (shielded back): the pool's collateral token, any
 * unspent debt token, and (if partial close) the position NFT.
 *
 * For a long that means repaying fxUSD to release wstETH/WBTC; for a short,
 * repaying wstETH/WBTC to release fxUSD.
 *
 * **Single-protocol.** To exit into any other asset, use
 * `FxMintClose_ZeroXSwap_ComboMeal`, which puts a self-quoting 0x swap recipe
 * downstream of this one. Prior versions took a caller-supplied `swapQuote` and
 * forced WETH out for wstETH-Long; that path is gone.
 */
export class FxMintCloseRecipe extends Recipe {
  readonly id = 'fxmint-close-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Close',
    description: 'Close an f(x) position; withdraws the pool collateral.',
    minGasLimit: MIN_GAS_LIMIT_FXMINT_CLOSE,
  };

  constructor(private readonly opts: FxMintCloseRecipeOpts) {
    super();
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(_first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    return [
      // Approve the pool's own manager to pull the pool's own debt token —
      // both are per-pool, so neither can come from a module constant.
      new ApproveERC20SpenderStep(
        pool.poolManager,
        { tokenAddress: pool.debtToken, decimals: pool.debtDecimals },
        this.opts.approveAmount,
      ),
      new FxMintClosePositionStep({
        pool,
        positionId: this.opts.positionId,
        repayAmount: this.opts.repayAmount,
        withdrawColl: this.opts.withdrawColl,
        withdrawFeeRatio: this.opts.withdrawFeeRatio,
        partialClose: this.opts.partialClose,
      }),
    ];
  }
}
