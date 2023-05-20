import { BigNumber } from '@ethersproject/bignumber';
import {
  RecipeERC20Info,
  StepOutputERC20Amount,
} from '../models/export-models';
import { getRandomBytes } from '@railgun-community/quickstart';
import { RailgunNFTAmount } from '@railgun-community/shared-models';

export const nftAmountOne = () => {
  return BigNumber.from(1).toHexString();
};

export const getRandomNFTID = (): BigNumber => {
  const randomHex = `0x${getRandomBytes(32)}`;
  const randomID = BigNumber.from(randomHex);
  return randomID;
};

export const compareNFTs = (
  a: RailgunNFTAmount,
  b: RailgunNFTAmount,
): boolean => {
  return (
    compareTokenAddress(a.nftAddress, b.nftAddress) &&
    a.nftTokenType === b.nftTokenType &&
    BigNumber.from(a.tokenSubID).eq(b.tokenSubID) &&
    BigNumber.from(a.amountString).eq(b.amountString)
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
