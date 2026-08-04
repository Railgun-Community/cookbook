import {
  RecipePositionInfo,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoWithdrawCollateralQuote } from '../../api/morpho';

/**
 * Withdraws collateral from a Morpho Blue market to the ephemeral EOA
 * (EIP-7702). No ERC-20 input is consumed — the collateral leaves the
 * un-tokenized position and arrives as a deterministic token amount at the EOA
 * (`receiver`). Any inputs pass through untouched. Reverts if the withdrawal
 * would make the position unhealthy.
 */
export class MorphoBlueWithdrawCollateralStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Withdraw Collateral',
    description: 'Withdraws collateral from a Morpho Blue market.',
  };

  private readonly quote: MorphoWithdrawCollateralQuote;

  constructor(quote: MorphoWithdrawCollateralQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      params,
      marketId,
      collateralToken,
      collateralDecimals,
      withdrawAssets,
      onBehalf,
      receiver,
    } = this.quote;

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createWithdrawCollateral(
      params,
      withdrawAssets,
      onBehalf,
      receiver,
    );

    const withdrawnCollateral: StepOutputERC20Amount = {
      tokenAddress: collateralToken,
      decimals: collateralDecimals,
      expectedBalance: withdrawAssets,
      minBalance: withdrawAssets,
      approvedSpender: undefined,
    };

    // Debited from `onBehalf`'s position; paid to `receiver`. As with borrow,
    // the two are the same account on every shipped path, and the position
    // record must follow `onBehalf` if they ever diverge.
    const withdrawnPosition: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'collateral',
      direction: 'decrease',
      tokenAddress: collateralToken,
      decimals: collateralDecimals,
      amount: withdrawAssets,
    };

    return {
      crossContractCalls: [crossContractCall],
      // Withdrawal produces collateral tokens; existing inputs pass through.
      outputERC20Amounts: [withdrawnCollateral, ...input.erc20Amounts],
      outputNFTs: input.nfts,
      outputPositions: [withdrawnPosition],
    };
  }
}
