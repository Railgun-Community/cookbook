import { ZeroXSwapQuoteData } from '../../api/zero-x';
import {
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { filterSingleERC20AmountInput } from '../../utils/filters';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class ZeroXSwapStep extends Step {
  readonly name = '0x Exchange Swap';
  readonly description =
    'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.';

  private readonly quote: ZeroXSwapQuoteData;

  constructor(quote: ZeroXSwapQuoteData) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;

    const sellToken: RecipeERC20Info = {
      tokenAddress: this.quote.sellTokenAddress,
      isBaseToken: false,
    };

    const { erc20AmountForStep, unusedERC20Amounts } =
      filterSingleERC20AmountInput(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, sellToken) &&
          erc20Amount.approvedForSpender === this.quote.spender,
      );

    const populatedTransactions: PopulatedTransaction[] = [
      this.quote.populatedTransaction,
    ];
    const unwrappedBaseToken: StepOutputERC20Amount = {
      ...erc20AmountForStep,
      isBaseToken: true,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [],
      outputERC20Amounts: [unwrappedBaseToken, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
