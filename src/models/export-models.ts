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

export type SwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: bigint;
  isRailgun: boolean;
};

export type GetSwapQuote = (
  swapQuoteParams: SwapQuoteParams,
) => Promise<SwapQuoteData>;

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
