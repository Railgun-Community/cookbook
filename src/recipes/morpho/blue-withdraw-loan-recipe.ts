import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { MorphoBlueWithdrawLoanStep } from '../../steps/morpho/blue-withdraw-loan-step';
import { MarketParams } from '../../steps/morpho/morpho-blue-util';
import { RecipeConfig, StepInput } from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_REPAY } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
} from '../../utils/7702';

export type MorphoBlueWithdrawLoanRecipeOpts = {
  market: MarketParams;
  /** Blue `onBehalf` — whose supply claim shrinks. */
  owner: PositionOwner;
  /** The ephemeral EOA this batch runs as; the asset lands here and shields. */
  receiver: EphemeralExecutor | string;
  provider: Provider;
  /**
   * Assets to withdraw. Omit for a full exit, which switches the quote to
   * SHARES — the only correct denomination for "withdraw everything", because
   * interest accrues between building and inclusion and an assets-denominated
   * request leaves a share residue nothing later looks for.
   */
  withdrawAssets?: bigint;
};

/**
 * Withdraw lent loan asset from a Morpho Blue market back into RAILGUN.
 *
 * Unshields nothing: the position is already inside Blue, so the recipe is one
 * call whose output the shield epilogue sweeps.
 *
 * **Free liquidity, not health, is what refuses this.** Lent assets are out on
 * loan, and Blue reverts `InsufficientLiquidity` when
 * `totalSupplyAssets - totalBorrowAssets` falls below the withdrawal — so a
 * fully utilized market locks lenders out entirely, however healthy their
 * position. Collateral has no equivalent constraint, because collateral is never
 * lent out. The quote builder checks this at build time; without that the revert
 * is swallowed by `requireSuccess = false` and the batch mines having done
 * nothing, at full gas cost.
 *
 * A partial withdrawal up to the free liquidity is the workaround when a full
 * exit will not fit, and the builder's error says so rather than just refusing.
 */
export class MorphoBlueWithdrawLoanRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Withdraw Loan Asset',
    description: 'Withdraws lent loan asset from a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
  };

  private readonly opts: MorphoBlueWithdrawLoanRecipeOpts;

  constructor(opts: MorphoBlueWithdrawLoanRecipeOpts) {
    super();
    // Validate now rather than at step time: the shield leg sweeps this
    // account's balance, so a receiver that is not the executing account makes
    // the declared output unshieldable.
    resolveExecutorAddress(
      opts.receiver,
      'MorphoBlueWithdrawLoanRecipe receiver',
    );
    this.opts = opts;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { market, owner, receiver, provider, withdrawAssets } = this.opts;

    const quote =
      withdrawAssets === undefined
        ? await MorphoBlueAPI.getWithdrawAllLoanQuote({
            market,
            owner,
            receiver,
            provider,
          })
        : await MorphoBlueAPI.getWithdrawLoanQuote({
            market,
            withdrawAssets,
            owner,
            receiver,
            provider,
          });

    return [new MorphoBlueWithdrawLoanStep(quote)];
  }
}
