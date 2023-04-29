import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';

export const getWrappedBaseTokenAddress = (
  networkName: NetworkName,
): string => {
  const network = NETWORK_CONFIG[networkName];
  if (!network) {
    throw new Error(`Unknown network: ${networkName}`);
  }
  return network.baseToken.wrappedAddress.toLowerCase();
};
