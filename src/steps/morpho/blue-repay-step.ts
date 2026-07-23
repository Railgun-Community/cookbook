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
import { MorphoRepayQuote } from '../../api/morpho';
import { MORPHO_BLUE_ADDRESS } from './morpho-blue-util';

/**
 * Repays loan-token debt to a Morpho Blue market on behalf of the ephemeral EOA
 * (EIP-7702). Assets-denominated partial repay: consumes exactly `repayAssets`
 * of the loan token (which must be <= the current debt, else Morpho reverts).
 * Pure step consuming a {@link MorphoRepayQuote}.
 */
export class MorphoBlueRepayStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Repay',
    description: 'Repays loan-token debt to a Morpho Blue market.',
  };

  private readonly quote: MorphoRepayQuote;

  constructor(quote: MorphoRepayQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { params, loanToken, loanDecimals, repayAssets, onBehalf } =
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
      repayAssets,
    );

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createRepay(
      params,
      repayAssets,
      0n,
      onBehalf,
    );

    const spentLoanToken: RecipeERC20AmountRecipient = {
      ...loanInfo,
      amount: repayAssets,
      recipient: 'Morpho Blue Market',
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentLoanToken],
      // Debt reduction is un-tokenized; only loan-token change passes through.
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
