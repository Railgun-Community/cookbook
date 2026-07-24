import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../utils/token';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoRepaySharesQuote } from '../../api/morpho';
import { MORPHO_BLUE_ADDRESS } from './morpho-blue-util';

/**
 * Repays Morpho Blue debt BY SHARES (`repay(0, shares)`) on behalf of the
 * ephemeral EOA (EIP-7702). Shares-mode is the clean way to fully close a
 * position: it avoids debt growth between recipe build and inclusion.
 *
 * The exact loan pulled drifts with interest, so the step spends the
 * conservative `maxRepaidAssets` from the unshielded loan input (a revert-safe
 * no-op if drift exceeds the slippage buffer, never a loss) and reshields the
 * remainder. The caller must unshield at least `maxRepaidAssets` of the loan
 * token.
 */
export class MorphoBlueRepaySharesStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Repay (shares)',
    description: 'Repays Morpho Blue debt by borrow shares.',
    hasNonDeterministicOutput: true,
  };

  private readonly quote: MorphoRepaySharesQuote;

  constructor(quote: MorphoRepaySharesQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { params, loanToken, loanDecimals, repayShares, maxRepaidAssets, onBehalf } =
      this.quote;

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
    const crossContractCall = await contract.createRepay(
      params,
      0n,
      repayShares,
      onBehalf,
    );

    const spentLoanToken: RecipeERC20AmountRecipient = {
      ...loanInfo,
      amount: maxRepaidAssets,
      recipient: 'Morpho Blue Market (shares repay)',
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentLoanToken],
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
