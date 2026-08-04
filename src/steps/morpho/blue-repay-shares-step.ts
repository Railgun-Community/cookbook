import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  RecipePositionInfo,
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
 *
 * **Failure semantics (7702).** Benign, and revert-safe by construction:
 * `repay(0, shares)` burns all the shares or none, so interest drift beyond the
 * `maxRepaidAssets` buffer is a no-op rather than a partial burn. The loan token
 * is untouched at the executor and reshields.
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
    const {
      params,
      marketId,
      loanToken,
      loanDecimals,
      repayShares,
      expectedRepaidAssets,
      maxRepaidAssets,
      onBehalf,
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

    // Shares mode is the one case where the position delta is exact in a unit
    // the ERC20 channels cannot express. `repayShares` is what Morpho burns —
    // exactly, whenever the batch is included — while the asset figure drifts
    // with interest between build and inclusion. So the record carries both,
    // with `amount` set to the EXPECTED assets rather than the conservative
    // `maxRepaidAssets` declared as spent: the spend has to be an upper bound
    // (it sizes the unshield), but a debt reduction reported as an upper bound
    // would over-state how much of the position was closed.
    const repaidDebt: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'debt',
      direction: 'decrease',
      tokenAddress: loanToken,
      decimals: loanDecimals,
      amount: expectedRepaidAssets,
      shares: repayShares,
      estimateReason:
        `assets drift with interest between build and inclusion; ` +
        `\`shares\` (${repayShares}) is the exact burn and the actual assets ` +
        `land in [${expectedRepaidAssets}, ${maxRepaidAssets}]`,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentLoanToken],
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
      outputPositions: [repaidDebt],
    };
  }
}
