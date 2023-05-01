import { NetworkName } from '@railgun-community/shared-models';
import axios from 'axios';

export enum ZeroXApiEndpoint {
  GetSwapQuote = 'swap/v1/quote',
}

const zeroXApiUrl = (networkName: NetworkName): string => {
  switch (networkName) {
    case NetworkName.Ethereum:
      return 'https://api.0x.org/';
    case NetworkName.BNBChain:
      return 'https://bsc.api.0x.org/';
    case NetworkName.Polygon:
      return 'https://polygon.api.0x.org/';
    case NetworkName.Arbitrum:
      return 'https://arbitrum.api.0x.org/';
    case NetworkName.EthereumGoerli:
      return 'https://goerli.api.0x.org/';
    case NetworkName.PolygonMumbai:
      return 'https://mumbai.api.0x.org/';
    case NetworkName.ArbitrumGoerli:
    case NetworkName.Railgun:
    case NetworkName.Hardhat:
    case NetworkName.EthereumRopsten_DEPRECATED:
      throw new Error(`No 0x API URL for chain ${networkName}`);
  }
};

export const zeroXSupportsNetwork = (networkName: NetworkName): boolean => {
  try {
    zeroXApiUrl(networkName);
    return true;
  } catch {
    return false;
  }
};

const paramString = (params?: Record<string, any>) => {
  if (!params) {
    return '';
  }
  const searchParams = new URLSearchParams(params);
  return searchParams.toString() ? `?${searchParams.toString()}` : '';
};

export const createZeroXUrl = (
  endpoint: ZeroXApiEndpoint,
  networkName: NetworkName,
  params?: Record<string, any>,
) => {
  const url = `${zeroXApiUrl(networkName)}${endpoint}${paramString(params)}`;
  return url;
};

export const getZeroXData = async <T>(
  endpoint: ZeroXApiEndpoint,
  networkName: NetworkName,
  params?: Record<string, any>,
): Promise<T> => {
  const url = createZeroXUrl(endpoint, networkName, params);
  const rsp = await axios.get(url);
  return rsp.data;
};
