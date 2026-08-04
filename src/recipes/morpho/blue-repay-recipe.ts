import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueRepayStep } from '../../steps/morpho/blue-repay-step';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_REPAY } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import { PositionOwner, resolvePositionOwnerAddress } from '../../utils/7702';
import { findFirstInputERC20Amount } from '../../utils/filters';

/**
 * Repay-only recipe against an existing Morpho Blue debt. Unshields the loan
 * token, approves the Blue singleton for the exact amount, and repays
 * (assets-denominated; must be <= current debt). The position (and any
 * remaining debt) stays with the same owner.
 *
 * **Owner-only — there is no receiver role here.** `Morpho.repay` takes no
 * `receiver`: the loan token is pulled from `msg.sender` (the executing
 * ephemeral EOA) and the debt of `onBehalf` falls. Morpho lets anyone repay
 * anyone's debt, so no authorization is involved, and `owner` may be any
 * account — including one this batch does not run as. It is also therefore
 * irreversible in the wrong direction: repaying the wrong owner is a gift.
 *
 * Self-contained: reads the loan-token decimals on-chain and validates the
 * owner. The repay amount comes from the unshielded input.
 */
export class MorphoBlueRepayRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Repay',
    description: 'Repays loan-token debt on a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
  };

  private readonly market: MarketParams;
  private readonly owner: string;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    owner: PositionOwner,
    provider: Provider,
  ) {
    super();
    this.market = market;
    this.owner = resolvePositionOwnerAddress(
      owner,
      'MorphoBlueRepayRecipe owner',
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

    return [
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        loanInfo,
        repayQuote.repayAssets,
      ),
      new MorphoBlueRepayStep(repayQuote),
    ];
  }
}
