import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  FEE_DENOM,
  resolvePool,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintAdjustPositionStep } from '../../../steps/borrow/fx/fx-mint-adjust-position-step';
import { MIN_GAS_LIMIT_FXMINT_ADJUST } from '../../../models/min-gas-limits';

export type FxMintRepayDebtRecipeOpts = {
  pool: FxMintPoolRef;
  positionId: bigint;
  /**
   * > 0; debt reduction in **native `pool.debtToken` units** (pre-computed via
   * `computeFxRepay`). fxUSD on a long, wstETH/WBTC on a short.
   */
  repayAmount: bigint;
  /**
   * = repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM. Pre-computed
   * via computeFxRepay. PoolManager pulls this exact amount of fxUSD from
   * the relay-adapter via transferFrom; the recipe's leading
   * ApproveERC20SpenderStep authorizes that pull.
   */
  approveAmount: bigint;
  /**
   * 1e9-denominated; from getFxPool (Task 13).
   * PoolConfiguration.getPoolFeeRatio(pool, operator)[3].
   */
  repayFeeRatio: bigint;
};

/**
 * Cookbook recipe: Reduce debt on an existing f(x) position WITHOUT withdrawing
 * collateral. Symmetric counterpart to FxMintTopupRecipe — the two together are
 * the position's risk-management dials.
 *
 *   approve(PoolManager, pool.debtToken, approveAmount)
 *     → operate(positionId, 0, -repayAmount)
 *
 * Inputs (RecipeInput): the pool's DEBT token (caller's unshielded balance,
 * >= approveAmount) + position NFT. That is fxUSD on a long and wstETH/WBTC on
 * a short — read it off the descriptor rather than assuming fxUSD.
 * Outputs (shielded back): position NFT (same id), plus any unspent debt token
 * (cookbook's recipe-engine epilogue handles unconsumed input ERC-20s
 * automatically).
 *
 * Pool-agnostic: debt-axis only, no collateral movement.
 *
 * It DOES have a combo variant — `ZeroXSwap_FxMintRepay_ComboMeal`. An earlier
 * version of this comment said otherwise, reasoning that there is no collateral
 * leg to swap into or out of. That is the wrong axis: what constrains a repay is
 * that f(x) accepts only the debt token, so a holder of anything else cannot
 * repay at all and the swap belongs on the DEBT side. The absent collateral leg
 * makes the combo simpler than the close one, not unnecessary.
 *
 * Use case: position's CR is deteriorating from collateral price drop —
 * caller computes computeFxRepay({ debt, availableDebtToken,
 * desiredRepayAmount, repayFeeRatio, railgunUnshieldFeeBps }) →
 * { repayAmount, approveAmount } and passes both here. `debt` is
 * `getFxPosition().debt` — the native figure, never `.rawDebts`.
 */
export class FxMintRepayDebtRecipe extends Recipe {
  readonly id = 'fxmint-repay-debt-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Repay Debt',
    description:
      'Burn fxUSD to reduce debt on an f(x) Long position; collateral unchanged.',
    // A v0.1 hardcode of 1.5M survived here when the fx floors were
    // re-anchored. It sat below MIN_GAS_LIMIT_EMPTY (1.8M) — the measured cost
    // of a bare unshield+shield, which this recipe strictly contains before it
    // even reaches the approve and the operate(). `minGasLimit` is a floor
    // enforced in-contract, not a cap.
    minGasLimit: MIN_GAS_LIMIT_FXMINT_ADJUST,
  };

  constructor(private readonly opts: FxMintRepayDebtRecipeOpts) {
    super();
    // Recipe-level guards — fail at construction so callers see the misuse
    // before gas-estimate / dry-run, with a recipe-specific message rather
    // than a downstream PoolManager revert. Two distinct failure modes:
    //
    //   1. repayAmount <= 0 — wrong recipe (use FxMintBorrowMoreRecipe for
    //      debtDelta > 0). Step-level guard would catch (0, 0) but accepts
    //      negative debtDelta as a repay; we want this recipe to refuse
    //      anything but a strictly positive repay magnitude.
    //
    //   2. approveAmount != repayAmount × (FEE_DENOM + repayFeeRatio) /
    //      FEE_DENOM — caller hand-rolled the fee uplift and got it wrong.
    //      PoolManager.operate() will pull exactly this amount via
    //      transferFrom; a mismatch lands the recipe-engine's step-validator
    //      with a generic "input != spent+outputs+fees" error far from the
    //      cause. Enforce strict equality here so the error names the
    //      actual problem and points at computeFxRepay.
    if (opts.repayAmount <= 0n) {
      throw new Error(
        'fxmint: FxMintRepayDebtRecipe — repayAmount must be > 0',
      );
    }
    const expectedApprove =
      (opts.repayAmount * (FEE_DENOM + opts.repayFeeRatio)) / FEE_DENOM;
    if (opts.approveAmount !== expectedApprove) {
      throw new Error(
        `fxmint: FxMintRepayDebtRecipe — approveAmount must equal repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM ` +
          `(expected ${expectedApprove}, got ${opts.approveAmount}). Use computeFxRepay to derive both fields.`,
      );
    }
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(_first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    // Two-step recipe: approve fxUSD to PoolManager, then operate() with a
    // negative debtDelta (== repay).
    //
    //   Approve amount = repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM
    //   — caller pre-computes both via computeFxRepay and passes them in.
    //   We do NOT recompute here: the same uplift formula is also applied
    //   to the unshield path's railgun fee, and the only authoritative
    //   source is computeFxRepay.
    //
    //   debtDelta = -repayAmount (signed; the step's operate() helper
    //   handles negative magnitudes as repay branches in PoolManager).
    return [
      new ApproveERC20SpenderStep(
        pool.poolManager,
        { tokenAddress: pool.debtToken, decimals: pool.debtDecimals },
        this.opts.approveAmount,
      ),
      new FxMintAdjustPositionStep({
        pool,
        positionId: this.opts.positionId,
        collDelta: 0n,
        debtDelta: -this.opts.repayAmount,
        repayFeeRatio: this.opts.repayFeeRatio,
      }),
    ];
  }
}
