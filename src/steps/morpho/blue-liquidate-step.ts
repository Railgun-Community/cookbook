import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../utils/token';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoLiquidationQuote } from '../../api/morpho';
import { MORPHO_BLUE_ADDRESS } from './morpho-blue-util';

/**
 * Liquidates an unhealthy Morpho Blue borrower from the ephemeral EOA
 * (EIP-7702), which is the liquidator (`msg.sender`): the loan token is pulled
 * from it to repay debt and the seized collateral is sent to it. Seize-mode:
 * seizes exactly `seizedCollateralAssets` (deterministic output).
 *
 * The loan pulled is computed via the exact Morpho seize math; the step spends
 * the conservative `maxRepaidAssets` from the unshielded loan input (reverting
 * safely, never losing funds, if interest/price drift exceeds the slippage
 * buffer) and reshields the remainder. The caller must unshield at least
 * `maxRepaidAssets` of the loan token.
 */
export class MorphoBlueLiquidateStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Liquidate',
    description: 'Liquidates an unhealthy borrower on a Morpho Blue market.',
    hasNonDeterministicOutput: true,
  };

  private readonly quote: MorphoLiquidationQuote;

  constructor(quote: MorphoLiquidationQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      params,
      borrower,
      loanToken,
      loanDecimals,
      collateralToken,
      collateralDecimals,
      seizedCollateralAssets,
      maxRepaidAssets,
    } = this.quote;

    const loanInfo: RecipeERC20Info = {
      tokenAddress: loanToken,
      decimals: loanDecimals,
    };
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      input.erc20Amounts,
      erc20Amount =>
        compareERC20Info(erc20Amount, loanInfo) &&
        isApprovedForSpender(erc20Amount, MORPHO_BLUE_ADDRESS),
      maxRepaidAssets,
    );

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createLiquidate(
      params,
      borrower,
      seizedCollateralAssets,
    );

    const spentLoanToken: RecipeERC20AmountRecipient = {
      ...loanInfo,
      amount: maxRepaidAssets,
      recipient: 'Morpho Blue Market (liquidation repay)',
    };
    const seizedCollateral: StepOutputERC20Amount = {
      tokenAddress: collateralToken,
      decimals: collateralDecimals,
      // Deterministic: seize-mode seizes exactly seizedCollateralAssets.
      expectedBalance: seizedCollateralAssets,
      minBalance: seizedCollateralAssets,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentLoanToken],
      outputERC20Amounts: [seizedCollateral, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
