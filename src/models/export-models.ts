import {
  NetworkName,
  RailgunERC20AmountRecipient,
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
  isBaseToken: boolean;
};

export type RecipeERC20Amount = RecipeERC20Info & {
  amount: BigNumber;
};

export type RecipeERC20AmountRecipient = RecipeERC20Amount & {
  recipient: string;
};

export type RecipeInput = {
  networkName: NetworkName;
  unshieldERC20Amounts: RecipeERC20Amount[];
  unshieldNFTs: RailgunNFTAmount[];
};

export type StepInput = {
  networkName: NetworkName;
  erc20Amounts: StepOutputERC20Amount[];
  nfts: RailgunNFTAmount[];
};

export type RecipeOutput = {
  stepOutputs: StepOutput[];
  populatedTransactions: PopulatedTransaction[];
  shieldERC20Addresses: string[];
  shieldNFTs: RailgunNFTAmount[];
  feeERC20AmountRecipients: RailgunERC20AmountRecipient[];
};

export type StepOutputERC20Amount = RecipeERC20Info & {
  expectedBalance: BigNumber;
  minBalance: BigNumber;
};

export type UnvalidatedStepOutput = {
  populatedTransactions: PopulatedTransaction[];
  spentERC20Amounts: RecipeERC20Amount[];
  outputERC20Amounts: StepOutputERC20Amount[];
  spentNFTs: RailgunNFTAmount[];
  outputNFTs: RailgunNFTAmount[];
  feeERC20AmountRecipients: RecipeERC20AmountRecipient[];
};

export type StepOutput = UnvalidatedStepOutput & {
  name: string;
  description: string;
};
