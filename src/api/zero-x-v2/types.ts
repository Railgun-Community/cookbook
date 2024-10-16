import {
  NetworkName,
} from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
  SwapQuoteData,
} from '../../models';


export type SwapQuoteDataV2 = SwapQuoteData & {
  zid: string;
};

export type V2BaseAPIParams = {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
};

export type V2QuoteParams = V2BaseAPIParams & {
  taker: string;
  txOrigin: string; // The contract address of the external account that started the transaction. This is only needed if taker is a smart contract.
  slippageBps?: number; //Default: 100 - The maximum acceptable slippage of the buyToken in Bps. If this parameter is set to 0, no slippage will be tolerated. If not provided, the default slippage tolerance is 100Bps
};

export type V2SwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: number;
  isRailgun: boolean;
};

export type ZeroXV2Transaction = {
  to: string;
  data: string;
  value: string;
  gasPrice: string;
  gas: string;
};

export type ZeroXV2Allowance = {
  actual: string; //The taker's current allowance of the spender
  spender: string; //The address to set the allowance on
};

export type ZeroXV2Balance = {
  token: string; // The contract address of the sellToken
  actual: string; // The current balance of the sellToken in the taker address
  expected: string; // The balance of the sellToken required for the swap to execute successfully
};

export type ZeroXV2Issues = {
  allowance: ZeroXV2Allowance;
  balance: ZeroXV2Balance;
  simulationIncomplete: boolean; //This is set to true when 0x cannot validate the transaction. This happens when the taker has an insufficient balance of the sellToken and 0x is unable to peform ehanced quote validation with the low balance. Note that this does not necessarily mean that the trade will revert
  invalidSourcesPassed: string[]; // A list of invalid sources present in excludedSources request. See https://api.0x.org/sources?chainId= with the desired chain's ID for the list of valid sources
};

export type ZeroXV2PriceData = {
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  sellToken: string;
  transaction: ZeroXV2Transaction;
  liquidityAvailable: boolean; // This validates the availability of liquidity for the quote requested. The rest of the fields will only be returned if true
  zid: string; // The unique ZeroEx identifier of the request
  issues: ZeroXV2Issues;
};

export type ZeroXAPIErrorData = {
  name: string;
  message: string;
  data?: {
    details?: Array<{
      field: string;
      reason: string;
    }>;
  };
}