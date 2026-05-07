import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, ZeroXV2SwapStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput, SwapQuoteData } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import type { Address } from 'viem';
import { FX_ADDRESSES, resolvePool, type FxMintPoolRef } from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintOpenPositionStep } from '../../../steps/borrow/fx/fx-mint-open-position-step';

export type FxMintOpenRecipeOpts = {
  pool: FxMintPoolRef;
  /** Absolute fxUSD debt to mint. */
  targetDebt: bigint;
  /** Predicted positionId from Pool.getNextPositionId(). Race-checked at gas-estimate. */
  predictedPositionId: bigint;
  /** 0x v2 swap quote (WETH → collateralToken). Caller fetches via Cookbook's quote helper. */
  swapQuote: SwapQuoteData;
  slippageBasisPoints: number;
};

/**
 * Cookbook recipe: Open a new f(x) Long position from shielded WETH.
 *
 *   approve 0x AllowanceTarget → swap WETH → collateral (0x v2)
 *   → approve PoolManager → operate(open)
 *
 * Inputs (RecipeInput.erc20Amounts): WETH (full unshielded amount).
 * Outputs (shielded back): fxUSD + position NFT (predictedPositionId).
 *
 * The leading ApproveERC20SpenderStep is required even with `ZeroXV2SwapStep`
 * because that step verifies, but does not grant, the AllowanceTarget approval.
 */
export class FxMintOpenRecipe extends Recipe {
  readonly id = "fxmint-open-v1";
  readonly config: RecipeConfig = {
    name: "fxMINT Open",
    description: "WETH → collateral (0x) → operate(open) on f(x) Long pool.",
    minGasLimit: 1_500_000n,
  };

  constructor(private readonly opts: FxMintOpenRecipeOpts) {
    super();
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(_first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);
    const weth = FX_ADDRESSES.WETH as Address;
    const poolManager = FX_ADDRESSES.fxPoolManager as Address;

    // Post-swap approve + operate use whatever collateral the swap actually
    // produces (non-deterministic by slippage). Cookbook rejects fixed
    // amounts on steps following a non-deterministic step.

    return [
      new ApproveERC20SpenderStep(
        this.opts.swapQuote.spender,
        { tokenAddress: weth, decimals: 18n },
      ),
      new ZeroXV2SwapStep(this.opts.swapQuote, { tokenAddress: weth, decimals: 18n }),
      new ApproveERC20SpenderStep(
        poolManager,
        { tokenAddress: pool.collateralToken, decimals: 18n },
      ),
      new FxMintOpenPositionStep({
        pool: pool.address,
        collateralToken: pool.collateralToken,
        targetDebt: this.opts.targetDebt,
        predictedPositionId: this.opts.predictedPositionId,
      }),
    ];
  }
}
