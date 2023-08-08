import { getRandomBytes } from '@railgun-community/wallet';

export const getRandomShieldPrivateKey = () => {
  return getRandomBytes(32);
};
