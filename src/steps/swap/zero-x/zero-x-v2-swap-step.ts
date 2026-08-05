import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  SwapQuoteData,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils/token';
import { Step } from '../../step';
import {
  ZERO_X_V2_EXCHANGE_LABEL,
  ZERO_X_V2_SWAP_DESCRIPTION,
  ZERO_X_V2_SWAP_STEP_NAME,
} from '../../../api/swap/zero-x-v2-swap-provider';

/**
 * **Failure semantics (7702).** Benign. The sell token is untouched at the
 * executor and is in the shield request list, so it comes back; downstream steps
 * that wanted the buy token fail harmlessly too. A stale or slippage-busted quote
 * therefore costs the unshield + shield fees and nothing else. What does survive
 * is the unlimited allowance the preceding `ApproveERC20SpenderStep` grants to
 * `quote.spender`. See `steps/failure-modes.ts`.
 */
export class ZeroXV2SwapStep extends Step {
  // Taken from the provider rather than repeated. `SwapRecipe`'s output
  // introspection locates the swap step by matching this name, so the two
  // drifting apart breaks quote read-back silently rather than loudly.
  readonly config: StepConfig = {
    name: ZERO_X_V2_SWAP_STEP_NAME,
    description: ZERO_X_V2_SWAP_DESCRIPTION,
    hasNonDeterministicOutput: true,
  };

  private readonly quote: SwapQuoteData;
  private readonly sellERC20Info: RecipeERC20Info;

  constructor(quote: SwapQuoteData, sellERC20Info: RecipeERC20Info) {
    super();
    this.quote = quote;
    this.sellERC20Info = sellERC20Info;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      buyERC20Amount,
      minimumBuyAmount,
      crossContractCall,
      sellTokenValue,
      spender,
    } = this.quote;
    const { erc20Amounts } = input;

    const sellERC20Amount = BigInt(sellTokenValue);
    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, this.sellERC20Info) &&
          isApprovedForSpender(erc20Amount, spender),
        sellERC20Amount,
      );

    const sellERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...this.sellERC20Info,
      amount: erc20AmountForStep.expectedBalance,
      recipient: ZERO_X_V2_EXCHANGE_LABEL,
    };
    const outputBuyERC20Amount: StepOutputERC20Amount = {
      tokenAddress: buyERC20Amount.tokenAddress,
      decimals: buyERC20Amount.decimals,
      isBaseToken: buyERC20Amount.isBaseToken,
      expectedBalance: buyERC20Amount.amount,
      minBalance: minimumBuyAmount,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [sellERC20AmountRecipient],
      outputERC20Amounts: [outputBuyERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
