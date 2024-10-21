import {
  NetworkName,
  RailgunNFTAmount,
} from '@railgun-community/shared-models';
import { ContractTransaction } from 'ethers';

export type CookbookDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};

export type RecipeERC20Info = {
  tokenAddress: string;
  decimals: bigint;
  isBaseToken?: boolean;
};

export type RecipeERC20Amount = RecipeERC20Info & {
  amount: bigint;
  recipient?: string;
};

export type RecipeERC20AmountRecipient = RecipeERC20Amount & {
  recipient: string;
};

export type RecipeNFTInfo = RailgunNFTAmount & {
  owns?: string;
  recipient?: string;
};

export type RecipeNFTRecipient = RailgunNFTAmount & {
  recipient: string;
};

export type RecipeInput = {
  networkName: NetworkName;
  railgunAddress: string;
  erc20Amounts: RecipeERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type StepInput = {
  networkName: NetworkName;
  erc20Amounts: StepOutputERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type RecipeOutput = {
  name: string;
  stepOutputs: StepOutput[];
  crossContractCalls: ContractTransaction[];
  erc20AmountRecipients: RecipeERC20AmountRecipient[];
  nftRecipients: RecipeNFTRecipient[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
  minGasLimit: bigint;
};

export type StepOutputERC20Amount = RecipeERC20Info & {
  expectedBalance: bigint;
  minBalance: bigint;
  approvedSpender: Optional<string>;
  recipient?: string;
};

export type UnvalidatedStepOutput = {
  crossContractCalls: ContractTransaction[];
  outputERC20Amounts: StepOutputERC20Amount[];
  spentERC20Amounts?: RecipeERC20AmountRecipient[];
  spentNFTs?: RecipeNFTInfo[];
  outputNFTs: RecipeNFTInfo[];
  feeERC20AmountRecipients?: RecipeERC20AmountRecipient[];
};

export type StepOutput = UnvalidatedStepOutput & {
  name: string;
  description: string;
};

export type StepConfig = {
  name: string;
  description: string;
  hasNonDeterministicOutput?: boolean;
};

export type RecipeConfig = {
  name: string;
  description: string;
  minGasLimit: bigint;
};

export type ComboMealConfig = {
  name: string;
  description: string;
  minGasLimit: bigint;
};

export type SwapQuoteData = {
  price: bigint;
  guaranteedPrice: bigint;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: bigint;
  spender: Optional<string>;
  crossContractCall: ContractTransaction;
  slippageBasisPoints: bigint;
  sellTokenAddress: string;
  sellTokenValue: string;
};

export type SwapQuoteDataV2 = SwapQuoteData & {
  zid: string;
};

export type SwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: bigint;
  isRailgun: boolean;
};

export type SwapQuoteParamsV2 = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: number;
  isRailgun: boolean;
};

export type GetSwapQuote = (
  swapQuoteParams: SwapQuoteParams,
) => Promise<SwapQuoteData>;

export type GetSwapQuoteV2 = (
  swapQuoteParams: SwapQuoteParamsV2,
) => Promise<SwapQuoteDataV2>;

export type RecipeAddLiquidityData = {
  erc20AmountA: RecipeERC20Amount;
  erc20AmountB: RecipeERC20Amount;
  expectedLPAmount: RecipeERC20Amount;
  slippageBasisPoints: bigint;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export type RecipeRemoveLiquidityData = {
  lpERC20Amount: RecipeERC20Amount;
  expectedERC20AmountA: RecipeERC20Amount;
  expectedERC20AmountB: RecipeERC20Amount;
  slippageBasisPoints: bigint;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export enum UniswapV2Fork {
  Uniswap = 'Uniswap',
  SushiSwap = 'SushiSwap',
  PancakeSwap = 'PancakeSwap',
  Quickswap = 'Quickswap',
}


// ZeroXV2 
export type BaseAPIParamsV2 = {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
};

export type QuoteParamsV2 = BaseAPIParamsV2 & {
  taker: string;
  txOrigin: string; // The contract address of the external account that started the transaction. This is only needed if taker is a smart contract.
  slippageBps?: number; //Default: 100 - The maximum acceptable slippage of the buyToken in Bps. If this parameter is set to 0, no slippage will be tolerated. If not provided, the default slippage tolerance is 100Bps
  excludedSources: "0x_RFQ,Uniswap_V3"
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