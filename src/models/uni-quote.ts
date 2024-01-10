import { ContractTransaction } from "ethers";
import { RecipeERC20Amount } from "../models";

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
  routingType: string,
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

export interface UniswapQuoteInputs {
  slippage: number;
  tokenInAmount: string;
  tokenInAddress: string;
  tokenOutAddress: string;
}