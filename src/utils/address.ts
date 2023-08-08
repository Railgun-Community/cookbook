import { isAddress } from '@ethersproject/address';
import { validateRailgunAddress } from '@railgun-community/wallet';

export const validateContractAddress = (address: string) => {
  return isAddress(address);
};

export const getIsRailgunAddress = (address: string): boolean => {
  if (validateRailgunAddress(address)) {
    return true;
  }
  if (validateContractAddress(address)) {
    return false;
  }
  throw new Error(`Invalid address: ${address}`);
};
