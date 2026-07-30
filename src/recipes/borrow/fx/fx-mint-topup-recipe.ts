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

export type FxMintTopupRecipeOpts = {
  pool: FxMintPoolRef;
  /** Existing position to top up. */
  positionId: bigint;
};

/**
 * Cookbook recipe: Top up collateral on an existing f(x) Long position
 * WITHOUT changing debt.
 *
 *   approve(PoolManager, collateral) → operate(positionId, +coll, 0)
 *
 * Inputs (RecipeInput): the pool's collateral token, plus the position NFT.
 * Outputs (shielded back): the position NFT (same id; adjust ops never change
 * positionId, only full close burns). No fxUSD output — debt is unchanged.
 *
 * **Single-protocol.** To top up from any other asset, use
 * `ZeroXSwap_FxMintTopup_ComboMeal`.
 *
 * For "top up + borrow more in one tx" use `FxMintTopupAndBorrowRecipe`; for
 * "borrow more without adding collateral" use `FxMintBorrowMoreRecipe`.
 *
 * Builds on FxMintAdjustPositionStep with collDelta > 0, debtDelta = 0n. Since
 * debtDelta = 0n the step does NOT require borrowFeeRatio / repayFeeRatio
 * (those are debt-axis only — see step-level guard).
 */
export class FxMintTopupRecipe extends Recipe {
  readonly id = 'fxmint-topup-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Topup',
    description: 'Add collateral to an f(x) Long position; debt unchanged.',
    minGasLimit: MIN_GAS_LIMIT_FXMINT_ADJUST,
  };

  constructor(private readonly opts: FxMintTopupRecipeOpts) {
    super();
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    // The input collateral is what gets deposited, as-is. `first` is the
    // StepInput the recipe engine builds from RecipeInput, so its balances are
    // post-unshield and deterministic (min == expected).
    const collInput = assertCollateralInput(pool, first.erc20Amounts);

    return [
      new ApproveERC20SpenderStep(pool.poolManager, {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
      }),
      new FxMintAdjustPositionStep({
        pool,
        positionId: this.opts.positionId,
        collDelta: collInput.expectedBalance,
        debtDelta: 0n,
      }),
    ];
  }
}
