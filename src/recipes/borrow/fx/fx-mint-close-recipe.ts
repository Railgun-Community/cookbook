import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, ZeroXV2SwapStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput, SwapQuoteData } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import type { Address } from 'viem';
import { FX_ADDRESSES, resolvePool, type FxMintPoolRef } from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintClosePositionStep } from '../../../steps/borrow/fx/fx-mint-close-position-step';

// ---------------------------------------------------------------------------
// New public API — FxMintCloseRecipe
// ---------------------------------------------------------------------------

export type FxMintCloseRecipeOpts = {
  pool: FxMintPoolRef;
  positionId: bigint;
  repayAmount: bigint;
  withdrawColl: bigint;
  /** = repayAmount × (1 + repayFeeRatio/1e9). Pre-computed via computeFxClose. */
  approveAmount: bigint;
  /** True if position survives (caller's computeFxClose result). */
  partialClose: boolean;
  /** 0x v2 swap quote (collateralToken → WETH). */
  swapQuote: SwapQuoteData;
  slippageBasisPoints: number;
};

/**
 * Cookbook recipe: Close (or partially close) an f(x) Long position back to WETH.
 *
 *   approve PoolManager → operate(close) → approve 0x AllowanceTarget → swap collateral → WETH
 *
 * Inputs (RecipeInput): fxUSD (the unshielded balance) + the position NFT.
 * Outputs (shielded back): WETH + (if partial) the position NFT.
 */
export class FxMintCloseRecipe extends Recipe {
  readonly id = "fxmint-close-v1";
  readonly config: RecipeConfig = {
    name: "fxMINT Close",
    description: "operate(close) on f(x) Long pool → collateral → WETH (0x).",
    minGasLimit: 2_500_000n,
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
        positionId: this.opts.positionId,
        repayAmount: this.opts.repayAmount,
        withdrawColl: this.opts.withdrawColl,
        partialClose: this.opts.partialClose,
      }),
      new ApproveERC20SpenderStep(
        this.opts.swapQuote.spender,
        { tokenAddress: pool.collateralToken, decimals: 18n },
        this.opts.withdrawColl,
      ),
      new ZeroXV2SwapStep(
        this.opts.swapQuote,
        { tokenAddress: pool.collateralToken, decimals: 18n },
      ),
    ];
  }
}
