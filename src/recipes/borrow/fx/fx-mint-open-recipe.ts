import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import type { RecipeConfig, StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import {
  assertCollateralInput,
  resolvePool,
  type FxMintPoolRef,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintOpenPositionStep } from '../../../steps/borrow/fx/fx-mint-open-position-step';
import { MIN_GAS_LIMIT_FXMINT_OPEN } from '../../../models/min-gas-limits';

export type FxMintOpenRecipeOpts = {
  pool: FxMintPoolRef;
  /** Absolute fxUSD debt to mint. */
  targetDebt: bigint;
  /**
   * The id `operate()` will mint, from `Pool.getNextPositionId()`.
   *
   * **Not race-checked at gas-estimate** — an earlier version of this comment
   * said it was. It cannot be: the calldata passes positionId 0 (mint-new), and
   * 0 cannot revert on a taken id. If another opener takes the id first,
   * `operate()` still succeeds at the NEXT id, and the batch then reverts its
   * entire shield trying to approve the one declared here, leaving the
   * collateral public at the ephemeral account.
   *
   * Get it from `preflightFxOpen` in `api/borrow/fx`, immediately before
   * building, and pass the id back in so a stale one is reported rather than
   * discovered on chain.
   */
  predictedPositionId: bigint;
  /**
   * f(x)'s borrow fee for this (pool, operator), 1e9-denominated.
   * Caller fetches via PoolConfiguration.getPoolFeeRatio(pool, operator)[2]
   * (see getFxPool in cookbook/src/api/borrow/fx).
   */
  borrowFeeRatio: bigint;
  /**
   * f(x)'s supply fee for this (pool, operator), 1e9-denominated —
   * `getFxPool(...).supplyFeeRatio`, i.e. index [0] of the same tuple
   * `borrowFeeRatio` comes from, so a caller that already read one has this.
   *
   * Optional and ERC-20-neutral: the manager pulls the full collateral either
   * way. It only sharpens `recipeOutput.outputPositions` — omitted, the
   * collateral record is an upper bound (exact on a long, 0.3% high on a
   * short) and says so in its `estimateReason`.
   */
  supplyFeeRatio?: bigint;
};

/**
 * Cookbook recipe: Open a new f(x) Long position.
 *
 *   approve(PoolManager, collateral) → operate(open)
 *
 * Inputs (RecipeInput.erc20Amounts): the pool's collateral token (wstETH for
 * wstETH-Long, WBTC for WBTC-Long).
 * Outputs (shielded back): fxUSD + position NFT (predictedPositionId).
 *
 * **Single-protocol.** To open from any other asset, use
 * `ZeroXSwap_FxMintOpen_ComboMeal`, which puts a self-quoting 0x swap recipe
 * upstream of this one. Prior versions took a caller-supplied `swapQuote` and
 * hardcoded WETH as the input; that path is gone — the caller no longer fetches
 * quotes, and any input token is now supported through the combo.
 */
export class FxMintOpenRecipe extends Recipe {
  readonly id = 'fxmint-open-v1';
  readonly config: RecipeConfig = {
    name: 'fxMINT Open',
    description: 'Open an f(x) Long position from the pool collateral.',
    minGasLimit: MIN_GAS_LIMIT_FXMINT_OPEN,
  };

  constructor(private readonly opts: FxMintOpenRecipeOpts) {
    super();
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  protected async getInternalSteps(first: StepInput): Promise<Step[]> {
    const pool = resolvePool(this.opts.pool);

    assertCollateralInput(pool, first.erc20Amounts);

    return [
      new ApproveERC20SpenderStep(pool.poolManager, {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
      }),
      new FxMintOpenPositionStep({
        pool,
        targetDebt: this.opts.targetDebt,
        predictedPositionId: this.opts.predictedPositionId,
        borrowFeeRatio: this.opts.borrowFeeRatio,
        supplyFeeRatio: this.opts.supplyFeeRatio,
      }),
    ];
  }
}
