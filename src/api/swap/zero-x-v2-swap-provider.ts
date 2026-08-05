import { NetworkName } from '@railgun-community/shared-models';
import { ZeroXV2Quote } from '../zero-x-v2/zero-x-v2-quote';
import type { SwapProvider, SwapProviderQuoteParams } from './swap-provider';
import type { SwapQuoteData } from '../../models/export-models';

/** Display name. Must match `ZeroXV2SwapStep.config.name` — see {@link SwapProvider.name}. */
export const ZERO_X_V2_SWAP_STEP_NAME = '0x V2 Exchange Swap';

/** Counterparty label on the spent-amount record. */
export const ZERO_X_V2_EXCHANGE_LABEL = '0x V2 Exchange';

export const ZERO_X_V2_SWAP_DESCRIPTION =
  'Swaps two ERC20 tokens using 0x V2 Exchange DEX Aggregator.';

/**
 * The shipped provider, and currently the only one.
 *
 * A thin adapter over `ZeroXV2Quote.getSwapQuote` rather than a rewrite of it:
 * the existing quote function already returns the provider-agnostic
 * {@link SwapQuoteData}, so there is nothing to translate. What this adds is the
 * naming, so a caller can hold a provider without knowing it is 0x.
 *
 * `supportsNetwork` reports every network `ZeroXV2Quote` has an exchange address
 * for. It is stated here rather than inferred from a failed quote, so a caller
 * can route around an unsupported chain instead of discovering it by exception.
 */
export const ZERO_X_V2_SWAP_PROVIDER: SwapProvider = {
  name: ZERO_X_V2_SWAP_STEP_NAME,
  exchangeLabel: ZERO_X_V2_EXCHANGE_LABEL,
  description: ZERO_X_V2_SWAP_DESCRIPTION,

  supportsNetwork(networkName: NetworkName): boolean {
    try {
      // The address lookup throws for an unsupported chain, which is the
      // authoritative answer — a hardcoded list here would be a second source
      // of truth that could drift from the one the quote path actually uses.
      return (
        ZeroXV2Quote.zeroXExchangeAllowanceHolderAddress(networkName).length > 0
      );
    } catch {
      return false;
    }
  },

  async getQuote(params: SwapProviderQuoteParams): Promise<SwapQuoteData> {
    const {
      networkName,
      sellERC20Amount,
      buyERC20Info,
      slippageBasisPoints,
      recipient,
      isRailgun = false,
    } = params;
    return ZeroXV2Quote.getSwapQuote({
      networkName,
      sellERC20Amount,
      buyERC20Info,
      slippageBasisPoints,
      isRailgun,
      recipient,
    });
  },
};
