import { NetworkName } from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
  SwapQuoteData,
} from '../../models/export-models';

export type SwapProviderQuoteParams = {
  networkName: NetworkName;
  /** What to sell, and how much. */
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: number;
  /**
   * On-chain recipient of the swap output. Under EIP-7702 this is the ephemeral
   * EOA the batch executes as, because the shield leg sweeps that account's
   * balance — a third-party recipient makes the output unshieldable.
   */
  recipient: string;
  /** Route through the RAILGUN proxy rather than direct to the aggregator. */
  isRailgun?: boolean;
};

/**
 * What a DEX aggregator has to supply for the cookbook to swap through it.
 *
 * **This is a smaller surface than it looks, and that is the finding.** The swap
 * STEP is already provider-agnostic: it works entirely off {@link SwapQuoteData}
 * — `crossContractCall`, `spender`, `buyERC20Amount`, `minimumBuyAmount`,
 * `sellTokenValue` — and the only 0x-specific things in it are two display
 * strings. So adding a second aggregator never required restructuring the step
 * or the recipe engine; it required naming the three things that genuinely vary.
 *
 * `SwapQuoteData` was already the right shape. The seam that was missing is this
 * interface plus the two labels, so nothing downstream has to know which
 * aggregator produced a quote.
 *
 * Deliberately NOT part of this interface:
 * - **Approval.** Every aggregator is approved the same way, through
 *   `ApproveERC20SpenderStep` against `quote.spender`, which the quote already
 *   carries.
 * - **Configuration.** How a provider is configured (API key, proxy domain,
 *   nothing at all) is its own business; `getZeroXV2Readiness` is the 0x-specific
 *   answer to "am I set up", and a second provider would ship its own.
 * - **Sell-vs-buy denomination.** 0x V2 here quotes sell-amount only, and every
 *   caller that needs an exact output already sizes against `minimumBuyAmount`.
 *   A provider offering exact-output quotes would be a widening of this
 *   interface, not a reinterpretation of it.
 */
export type SwapProvider = {
  /**
   * Step and recipe display name, e.g. `'0x V2 Exchange Swap'`. Load-bearing:
   * `SwapRecipe.getBuySellAmountsFromRecipeOutput` locates the swap step by
   * matching this against `stepOutputs[2].name`, so a provider whose name does
   * not match its step's cannot be introspected.
   */
  readonly name: string;
  /**
   * Human label for the counterparty on the spent-amount record, e.g.
   * `'0x V2 Exchange'`. A label, never an address — the `RecipeERC20AmountRecipient`
   * `recipient` field is polymorphic and carries labels on spent/fee arrays.
   */
  readonly exchangeLabel: string;
  readonly description: string;
  supportsNetwork(networkName: NetworkName): boolean;
  getQuote(params: SwapProviderQuoteParams): Promise<SwapQuoteData>;
};
