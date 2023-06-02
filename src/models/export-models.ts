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
};

export type RecipeERC20AmountRecipient = RecipeERC20Amount & {
  recipient: string;
};

export type RecipeNFTInfo = RailgunNFTAmount & {
  owns?: string;
};

export type RecipeInput = {
  networkName: NetworkName;
  erc20Amounts: RecipeERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type StepInput = {
  networkName: NetworkName;
  erc20Amounts: StepOutputERC20Amount[];
  nfts: RecipeNFTInfo[];
};

export type RecipeOutput = {
  stepOutputs: StepOutput[];
  crossContractCalls: ContractTransaction[];
  erc20Amounts: RecipeERC20Amount[];
  nfts: RecipeNFTInfo[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
};

export type StepOutputERC20Amount = RecipeERC20Info & {
  expectedBalance: bigint;
  minBalance: bigint;
  approvedSpender: Optional<string>;
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
};

export type ComboMealConfig = {
  name: string;
  description: string;
};

export type SwapQuoteData = {
  price: bigint;
  guaranteedPrice: bigint;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: bigint;
  spender: Optional<string>;
  crossContractCall: ContractTransaction;
  slippagePercentage: number;
  sellTokenAddress: string;
  sellTokenValue: string;
};

export type SwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippagePercentage: number;
  isRailgun: boolean;
};

export type GetSwapQuote = (
  swapQuoteParams: SwapQuoteParams,
) => Promise<SwapQuoteData>;

export type RecipeAddLiquidityData = {
  erc20AmountA: RecipeERC20Amount;
  erc20AmountB: RecipeERC20Amount;
  expectedLPAmount: RecipeERC20Amount;
  slippagePercentage: number;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export type RecipeRemoveLiquidityData = {
  lpERC20Amount: RecipeERC20Amount;
  expectedERC20AmountA: RecipeERC20Amount;
  expectedERC20AmountB: RecipeERC20Amount;
  slippagePercentage: number;
  routerContractAddress: string;
  deadlineTimestamp: number;
};

export enum UniswapV2Fork {
  Uniswap = 'Uniswap',
  Sushiswap = 'Sushiswap',
}
