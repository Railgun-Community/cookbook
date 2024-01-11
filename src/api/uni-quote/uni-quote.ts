import axios from "axios"

import { Chain, NetworkName } from "@railgun-community/shared-models";
import { UniswapProtocolType, UniswapQuoteInputs, UniswapQuoteParams } from "../../models/uni-quote";

export class UniswapQuote {
  static getUniswapURL = () => {
    return 'https://api.uniswap.org'
  }

  static getUniswapQuoteURL = () => {
    return `${UniswapQuote.getUniswapURL()}/v2/quote`
  }

  static getUniswapHeaders = () => {
    return {
      headers: {
        accept: '*/*',
        origin: UniswapQuote.getUniswapURL(),
        'content-type': 'application/json',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      }
    }
  }

  static getUniswapPermit2ContractAddressForNetwork = (networkName: NetworkName) => {
    switch (networkName) {
      case NetworkName.Ethereum:
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.Arbitrum:
        {
          return '0x000000000022d473030f116ddee9f6b43ac78ba3';
        }
      default: {
        throw new Error("Unsupported network for Uniswap Permit2 contract.");
      }
    }
  }
  static getUniswapQuoteParams = (
    chain: Chain,
    recipientAddress: string,
    quoteInputs: UniswapQuoteInputs
  ): UniswapQuoteParams => {

    const {
      slippage,
      tokenInAmount,
      tokenInAddress: tokenIn,
      tokenOutAddress: tokenOut,
    } = quoteInputs;

    return {
      tokenInChainId: chain.id,
      tokenIn,
      tokenOutChainId: chain.id,
      tokenOut,
      amount: tokenInAmount,
      slippage,
      sendPortionEnabled: true,
      type: 'EXACT_INPUT',
      configs: [
        {
          protocols: [
            UniswapProtocolType.V2,
            UniswapProtocolType.V3,
            UniswapProtocolType.MIXED
          ],
          enableUniversalRouter: true,
          routingType: 'CLASSIC',
          recipient: recipientAddress,
          enableFeeOnTransferFeeFetching: true,
        },
      ],
    }
  }

  static getSwapQuote = async (quoteParams: UniswapQuoteParams) => {
    try {
      const response = await axios.post(
        UniswapQuote.getUniswapQuoteURL(),
        quoteParams,
        UniswapQuote.getUniswapHeaders()
      );
      return response?.data;
    } catch (error) {
      const uniswapError = new Error(`There was an error getting a quote from Uniswap. ${error.message}`, { cause: error });
      throw uniswapError;
    }
  }
}