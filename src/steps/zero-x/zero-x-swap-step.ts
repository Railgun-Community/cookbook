import { ZeroXSwapQuoteData } from '../../api/zero-x';
import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info } from '../../utils/token';
import { Step } from '../step';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class ZeroXSwapStep extends Step {
  readonly config = {
    name: '0x Exchange Swap',
    description: 'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
    hasNonDeterministicOutput: true,
  };

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
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, sellToken) &&
          erc20Amount.approvedForSpender === this.quote.spender,
      );

    const populatedTransactions: PopulatedTransaction[] = [
      this.quote.populatedTransaction,
    ];

    const { buyERC20Amount, minimumBuyAmount } = this.quote;

    const sellERC20AmountRecipient: RecipeERC20AmountRecipient = {
      tokenAddress: erc20AmountForStep.tokenAddress,
      amount: erc20AmountForStep.expectedBalance,
      recipient: '0x Exchange',
    };
    const outputBuyERC20Amount: StepOutputERC20Amount = {
      tokenAddress: buyERC20Amount.tokenAddress,
      isBaseToken: buyERC20Amount.isBaseToken,
      expectedBalance: buyERC20Amount.amount,
      minBalance: minimumBuyAmount,
      approvedForSpender: undefined,
    };

    return {
      populatedTransactions,
      spentERC20Amounts: [sellERC20AmountRecipient],
      outputERC20Amounts: [outputBuyERC20Amount, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
