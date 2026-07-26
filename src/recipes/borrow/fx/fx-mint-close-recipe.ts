import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  FX_ADDRESSES,
  resolvePool,
  type Address,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintClosePositionStep } from '../../../steps/borrow/fx/fx-mint-close-position-step';
import { MIN_GAS_LIMIT_FXMINT_CLOSE } from '../../../models/min-gas-limits';

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
};

/**
 * Cookbook recipe: Close (or partially close) an f(x) Long position.
 *
 *   approve(PoolManager, fxUSD) → operate(close)
 *
 * Inputs (RecipeInput): fxUSD (the unshielded balance) + the position NFT.
 * Outputs (shielded back): the pool's collateral token, any unspent fxUSD, and
 * (if partial close) the position NFT.
 *
 * **Single-protocol.** To exit into any other asset, use
 * `FxMintClose_ZeroXSwap_ComboMeal`, which puts a self-quoting 0x swap recipe
 * downstream of this one. Prior versions took a caller-supplied `swapQuote` and
 * forced WETH out for wstETH-Long; that path is gone.
 *
 * `computeFxClose` is unchanged — f(x) has no withdraw fee, so `withdrawColl`
 * stays a clean ratio.
 */
export class FxMintCloseRecipe extends Recipe {
  readonly id = 'fxmint-close-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Close',
    description: 'Close an f(x) Long position; withdraws the pool collateral.',
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
    const fxUSD = FX_ADDRESSES.fxUSD as Address;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;

    return [
      new ApproveERC20SpenderStep(
        poolManager,
        { tokenAddress: fxUSD, decimals: 18n },
        this.opts.approveAmount,
      ),
      new FxMintClosePositionStep({
        pool: pool.address,
        collateralToken: pool.collateralToken,
        collateralDecimals: pool.collateralDecimals,
        positionId: this.opts.positionId,
        repayAmount: this.opts.repayAmount,
        withdrawColl: this.opts.withdrawColl,
        partialClose: this.opts.partialClose,
      }),
    ];
  }
}
