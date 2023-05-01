import { isAddress } from '@ethersproject/address';

export const validateAddress = (address: string) => {
  return isAddress(address);
};
