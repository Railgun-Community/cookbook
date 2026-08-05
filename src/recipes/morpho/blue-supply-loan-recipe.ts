import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueSupplyLoanStep } from '../../steps/morpho/blue-supply-loan-step';
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
 * Lend into a Morpho Blue market: unshield the loan token, approve the Blue
 * singleton for the exact amount, and supply it, earning `supplyShares`.
 *
 * **This is the lend side, which had no path through the cookbook at all.**
 * `supply` and `withdraw` were in the shipped ABI with no steps behind them, so
 * every Blue recipe was a borrower recipe and a lender could not act.
 *
 * **Owner-only — there is no receiver role.** `Morpho.supply` takes no
 * `receiver`: the loan token is pulled from `msg.sender` (the executing
 * ephemeral EOA) and the claim credits `onBehalf`. Morpho lets anyone supply on
 * anyone's behalf, so no authorization is involved — and, exactly as with repay,
 * that makes it irreversible in the wrong direction. Supplying to the wrong
 * owner is a gift, and nothing reverts to tell you.
 *
 * The amount comes from the unshielded input, so the caller sizes the position
 * by choosing what to unshield rather than by passing a second figure that could
 * disagree with it.
 *
 * Gas floor is shared with repay — both are one approve plus one Blue call with
 * no oracle or health check. It is an inherited estimate, not a measured one.
 */
export class MorphoBlueSupplyLoanRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Supply Loan Asset',
    description: 'Lends the loan asset into a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
  };

  private readonly market: MarketParams;
  private readonly owner: string;
  private readonly provider: Provider;

  constructor(market: MarketParams, owner: PositionOwner, provider: Provider) {
    super();
    this.market = market;
    this.owner = resolvePositionOwnerAddress(
      owner,
      'MorphoBlueSupplyLoanRecipe owner',
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

    const supplyQuote = await MorphoBlueAPI.getSupplyLoanQuote({
      market: this.market,
      supplyAssets: loanInput.amount,
      owner: this.owner,
      provider: this.provider,
    });
    const loanInfo: RecipeERC20Info = {
      tokenAddress: this.market.loanToken,
      decimals: supplyQuote.loanDecimals,
    };

    return [
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        loanInfo,
        supplyQuote.supplyAssets,
      ),
      new MorphoBlueSupplyLoanStep(supplyQuote),
    ];
  }
}
