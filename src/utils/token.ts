import {
  RecipeERC20Info,
  StepOutputERC20Amount,
} from '../models/export-models';
import { getRandomBytes } from '@railgun-community/wallet';
import { RailgunNFTAmount } from '@railgun-community/shared-models';

export const getRandomNFTID = (): bigint => {
  const randomHex = `0x${getRandomBytes(32)}`;
  return BigInt(randomHex);
};

export const compareNFTs = (
  a: RailgunNFTAmount,
  b: RailgunNFTAmount,
): boolean => {
  return (
    compareTokenAddress(a.nftAddress, b.nftAddress) &&
    a.nftTokenType === b.nftTokenType &&
    BigInt(a.tokenSubID) === BigInt(b.tokenSubID) &&
    a.amount === b.amount
  );
};

export const compareTokenAddress = (a: string, b: string): boolean => {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
};

export const compareTokenAddresses = (list: string[], b: string): boolean => {
  if (!list.length || !b) {
    return false;
  }
  return list.find(a => !compareTokenAddress(a, b)) != null;
};

export const compareERC20Info = (
  tokenA: RecipeERC20Info,
  tokenB: RecipeERC20Info,
): boolean => {
  return (
    compareTokenAddress(tokenA.tokenAddress, tokenB.tokenAddress) &&
    !!tokenA.isBaseToken === !!tokenB.isBaseToken
  );
};

export const isApprovedForSpender = (
  erc20Amount: StepOutputERC20Amount,
  spender: Optional<string>,
) => {
  return !spender || erc20Amount.approvedSpender === spender;
};
