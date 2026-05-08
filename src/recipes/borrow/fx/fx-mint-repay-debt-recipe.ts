import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import type { Address } from 'viem';
import { FX_ADDRESSES, resolvePool, type FxMintPoolRef } from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintAdjustPositionStep } from '../../../steps/borrow/fx/fx-mint-adjust-position-step';

export type FxMintRepayDebtRecipeOpts = {
  pool: FxMintPoolRef;
  positionId: bigint;
  /** > 0; debt reduction in fxUSD wei (pre-computed via computeFxRepay). */
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
 * Cookbook recipe: Reduce debt on an existing f(x) Long position WITHOUT
 * withdrawing collateral. Symmetric counterpart to FxMintTopupRecipe —
 * the two together are the position's risk-management dials.
 *
 *   approve(PoolManager, fxUSD, approveAmount)
 *     → operate(positionId, 0, -repayAmount)
 *
 * Inputs (RecipeInput): fxUSD (caller's unshielded balance, >= approveAmount)
 * + position NFT.
 * Outputs (shielded back): position NFT (same id), plus any unspent fxUSD
 * (cookbook's recipe-engine epilogue handles unconsumed input ERC-20s
 * automatically).
 *
 * Pool-agnostic: no swap leg, no collateral movement. No call to
 * validatePoolFlow — that helper enforces collateral-axis rules
 * (wstETH-Long needs WETH→wstETH swap, WBTC-Long is direct), which don't
 * apply to debt-only recipes.
 *
 * Use case: position's CR is deteriorating from collateral price drop —
 * caller computes computeFxRepay({ rawDebts, shieldedFxUSD,
 * desiredRepayAmount, repayFeeRatio, railgunUnshieldFeeBps }) →
 * { repayAmount, approveAmount } and passes both here.
 */
export class FxMintRepayDebtRecipe extends Recipe {
  readonly id = "fxmint-repay-debt-v1";
  readonly config: RecipeConfig = {
    name: "fxMINT Repay Debt",
    description: "Burn fxUSD to reduce debt on an f(x) Long position; collateral unchanged.",
    minGasLimit: 1_500_000n,
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
    //   2. approveAmount < repayAmount — caller skipped the fee uplift.
    //      PoolManager pulls (repayAmount × (1 + repayFeeRatio/1e9)) via
    //      transferFrom, so an under-approve guarantees an ERC20 revert.
    //      Reject with a fee-uplift hint pointing to computeFxRepay.
    if (opts.repayAmount <= 0n) {
      throw new Error(
        'fxmint: FxMintRepayDebtRecipe — repayAmount must be > 0',
      );
    }
    if (opts.approveAmount < opts.repayAmount) {
      throw new Error(
        'fxmint: FxMintRepayDebtRecipe — approveAmount must be >= repayAmount (fee uplift). Use computeFxRepay to derive both.',
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
        poolManager,
        { tokenAddress: fxUSD, decimals: 18n },
        this.opts.approveAmount,
      ),
      new FxMintAdjustPositionStep({
        pool: pool.address,
        collateralToken: pool.collateralToken,
        collateralDecimals: pool.collateralDecimals,
        positionId: this.opts.positionId,
        collDelta: 0n,
        debtDelta: -this.opts.repayAmount,
        repayFeeRatio: this.opts.repayFeeRatio,
      }),
    ];
  }
}
