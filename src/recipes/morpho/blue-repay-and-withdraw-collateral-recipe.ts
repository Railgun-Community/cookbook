import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueRepayStep } from '../../steps/morpho/blue-repay-step';
import { MorphoBlueWithdrawCollateralStep } from '../../steps/morpho/blue-withdraw-collateral-step';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
} from '../../utils/7702';
import { findFirstInputERC20Amount } from '../../utils/filters';

/**
 * Unwind a Morpho Blue position in one batch: repay loan-token debt with the
 * unshielded loan token, then withdraw collateral to the executing ephemeral
 * EOA (EIP-7702), which shields it. Repay is assets-denominated (must be <=
 * current debt); withdrawing collateral reverts if it would leave the position
 * unhealthy.
 *
 * Self-contained: reads token decimals on-chain via {@link MorphoBlueAPI} and
 * validates the accounts. The loan amount to repay comes from the unshielded
 * input; the collateral amount to withdraw is a caller parameter.
 *
 * `owner` defaults to the executor. When it differs, this batch repays a
 * durable owner's debt (never authorization-gated) and withdraws that owner's
 * collateral to the executor (gated — preflighted at quote time). Ordering
 * matters for the failure mode: an unauthorised withdraw would leave the debt
 * repaid and the collateral behind, which is why the guard is at build time.
 */
export class MorphoBlueRepayAndWithdrawCollateralRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Repay + Withdraw Collateral',
    description: 'Repays debt and withdraws collateral from a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW,
  };

  private readonly market: MarketParams;
  private readonly withdrawCollateralAssets: bigint;
  private readonly executor: string;
  private readonly owner: string;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    withdrawCollateralAssets: bigint,
    executor: EphemeralExecutor | string,
    provider: Provider,
    owner?: PositionOwner,
  ) {
    super();
    this.market = market;
    this.withdrawCollateralAssets = withdrawCollateralAssets;
    this.executor = resolveExecutorAddress(
      executor,
      'MorphoBlueRepayAndWithdrawCollateralRecipe executor',
    );
    this.owner =
      owner === undefined
        ? this.executor
        : resolvePositionOwnerAddress(
            owner,
            'MorphoBlueRepayAndWithdrawCollateralRecipe owner',
          );
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const loanInput = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      { tokenAddress: this.market.loanToken, decimals: 0n },
    );

    const repayQuote = await MorphoBlueAPI.getRepayQuote({
      market: this.market,
      repayAssets: loanInput.amount,
      owner: this.owner,
      provider: this.provider,
    });
    const loanInfo: RecipeERC20Info = {
      tokenAddress: this.market.loanToken,
      decimals: repayQuote.loanDecimals,
    };

    const withdrawQuote = await MorphoBlueAPI.getWithdrawCollateralQuote({
      market: this.market,
      withdrawAssets: this.withdrawCollateralAssets,
      owner: this.owner,
      receiver: this.executor,
      provider: this.provider,
    });

    return [
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        loanInfo,
        repayQuote.repayAssets,
      ),
      new MorphoBlueRepayStep(repayQuote),
      new MorphoBlueWithdrawCollateralStep(withdrawQuote),
    ];
  }
}
