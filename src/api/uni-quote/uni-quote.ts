import axios from "axios"

import { Chain } from "@railgun-community/shared-models";
import { UniswapProtocolType, UniswapQuoteInputs, UniswapQuoteParams } from "../../models/uni-quote";

export class UniswapQuote {
  getUniswapURL = () => {
    return 'https://api.uniswap.org'
  }

  getUniswapQuoteURL = () => {
    return `${this.getUniswapURL()}/v2/quote`
  }

  getUniswapHeaders = () => {
    return {
      headers: {
        accept: '*/*',
        origin: this.getUniswapURL(),
        'content-type': 'application/json',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      }
    }
  }

  getUniswapQuoteParams = (
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

  fetchUniswapQuote = async (quoteParams: UniswapQuoteParams) => {
    try {
      const response = await axios.post(
        this.getUniswapQuoteURL(),
        quoteParams,
        this.getUniswapHeaders()
      );
      return response?.data;
    } catch (error) {
      const uniswapError = new Error(`There was an error getting a quote from Uniswap. ${error.message}`, { cause: error });
      throw uniswapError;
    }
  }
}