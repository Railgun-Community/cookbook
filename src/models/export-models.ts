import {
  NetworkName,
  RailgunNFTAmount,
} from '@railgun-community/shared-models';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { BigNumber } from '@ethersproject/bignumber';

export type CookbookDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};

export type RecipeERC20Info = {
  tokenAddress: string;
  decimals: number;
  isBaseToken?: boolean;
};

export type RecipeERC20Amount = RecipeERC20Info & {
  amount: BigNumber;
};

export type RecipeERC20AmountRecipient = RecipeERC20Amount & {
  recipient: string;
};

export type RecipeInput = {
  networkName: NetworkName;
  erc20Amounts: RecipeERC20Amount[];
  nfts: RailgunNFTAmount[];
};

export type StepInput = {
  networkName: NetworkName;
  erc20Amounts: StepOutputERC20Amount[];
  nfts: RailgunNFTAmount[];
};

export type RecipeOutput = {
  stepOutputs: StepOutput[];
  populatedTransactions: PopulatedTransaction[];
  erc20Amounts: RecipeERC20Amount[];
  nfts: RailgunNFTAmount[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
};

export type StepOutputERC20Amount = RecipeERC20Info & {
  expectedBalance: BigNumber;
  minBalance: BigNumber;
  approvedSpender: Optional<string>;
};

export type UnvalidatedStepOutput = {
  populatedTransactions: PopulatedTransaction[];
  spentERC20Amounts: RecipeERC20AmountRecipient[];
  outputERC20Amounts: StepOutputERC20Amount[];
  spentNFTs: RailgunNFTAmount[];
  outputNFTs: RailgunNFTAmount[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
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
  price: BigNumber;
  guaranteedPrice: BigNumber;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: BigNumber;
  spender: Optional<string>;
  populatedTransaction: PopulatedTransaction;
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
