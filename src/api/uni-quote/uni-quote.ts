import axios from "axios"
import { ContractTransaction } from "ethers";
import { RecipeERC20Amount } from "../../models";

export enum UniswapProtocolType {
  V2 = "V2",
  V3 = "V3",
  MIXED = "MIXED"
}
export type UniswapSwapQuoteData = {
  price: bigint;
  guaranteedPrice: bigint;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: bigint;
  spender: Optional<string>;
  crossContractCall: ContractTransaction;
  sellTokenAddress: string;
  sellTokenValue: string;
};
export type UniswapQuoteParamConfig = {
  protocols: UniswapProtocolType[],
  enableUniversalRouter: boolean,
  routingType: string, // 'CLASSIC' direct tie to this, and the other?
  recipient: string,
  enableFeeOnTransferFeeFetching: boolean,
}

export type UniswapQuoteParams = {
  tokenInChainId: number,
  tokenIn: string,
  tokenOutChainId: number,
  tokenOut: string,
  amount: string,
  slippage: number,
  sendPortionEnabled: boolean,
  type: string,
  configs: UniswapQuoteParamConfig[]
}

export const getUniswapURL = () => {
  return 'https://api.uniswap.org'
}

export const getUniswapQuoteURL = () => {
  return `${getUniswapURL()}/v2/quote`
}

export const getUniswapHeaders = () => {
  return {
    headers: {
      accept: '*/*',
      origin: getUniswapURL(),
      'content-type': 'application/json',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    }
  }
}

// GET QUOTE FUNCTIONS

export const fetchUniswapQuote = async (quoteParams: UniswapQuoteParams) => {
  try {
    const response = await axios.post(
      getUniswapQuoteURL(),
      quoteParams,
      getUniswapHeaders()
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const { data } = response;
    return data;
  } catch (error) {
    const uniswapError = new Error("There was an error getting a quote from Uniswap.");
    console.error(uniswapError);
    return undefined;
    // throw uniswapError;
  }
}