import { randomBytes } from 'ethers';
import {
  RecipeERC20Info,
  StepOutputERC20Amount,
} from '../models/export-models';
import { RailgunNFTAmount, isDefined } from '@railgun-community/shared-models';

export const getRandomNFTID = (): bigint => {
  const randomHex = Buffer.from(randomBytes(32)).toString('hex');
  return BigInt(`0x${randomHex}`);
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
    (tokenA.isBaseToken ?? false) === (tokenB.isBaseToken ?? false)
  );
};

export const isApprovedForSpender = (
  erc20Amount: StepOutputERC20Amount,
  spender: Optional<string>,
) => {
  return !isDefined(spender) || erc20Amount.approvedSpender === spender;
};
