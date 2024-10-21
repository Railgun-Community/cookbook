import { isAddress } from '@ethersproject/address';

export const validateContractAddress = (address: string) => {
  return isAddress(address);
};

export const isPrefixedRailgunAddress = (address: string): boolean => {
  if (address.startsWith('0zk')) {
    return true;
  }
  if (address.startsWith('0x')) {
    return false;
  }
  throw new Error(`Invalid address: ${address}`);
};
