import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { RecipeERC20Info } from '../../models';

const getWrappedBaseTokenAddress = (networkName: NetworkName): string => {
  const network = NETWORK_CONFIG[networkName];
  if (!network) {
    throw new Error(`Unknown network: ${networkName}`);
  }
  return network.baseToken.wrappedAddress.toLowerCase();
};

export const getWrappedBaseToken = (
  networkName: NetworkName,
): RecipeERC20Info => {
  return {
    tokenAddress: getWrappedBaseTokenAddress(networkName),
    isBaseToken: false,
  };
};

export const getBaseToken = (networkName: NetworkName): RecipeERC20Info => {
  return {
    tokenAddress: getWrappedBaseTokenAddress(networkName),
    isBaseToken: false,
  };
};
