import {
  NETWORK_CONFIG,
  NetworkName,
  isDefined,
} from '@railgun-community/shared-models';
import { RecipeERC20Info } from '../models/export-models';

export const getWrappedBaseToken = (
  networkName: NetworkName,
): RecipeERC20Info => {
  const network = NETWORK_CONFIG[networkName];
  if (!isDefined(network)) {
    throw new Error(`Unknown network: ${networkName}`);
  }
  return {
    tokenAddress: network.baseToken.wrappedAddress.toLowerCase(),
    decimals: BigInt(network.baseToken.decimals),
    isBaseToken: false,
  };
};

export const getBaseToken = (networkName: NetworkName): RecipeERC20Info => {
  return {
    ...getWrappedBaseToken(networkName),
    isBaseToken: true,
  };
};
