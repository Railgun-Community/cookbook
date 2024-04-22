import { NetworkName, isDefined } from '@railgun-community/shared-models';
import axios from 'axios';
import { ZeroXConfig } from '../../models/zero-x-config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type APIParams = Record<string, any>;

export enum ZeroXApiEndpoint {
  GetSwapQuote = 'swap/v1/quote',
}

export const zeroXApiSubdomain = (networkName: NetworkName): string => {
  switch (networkName) {
    case NetworkName.Ethereum:
      return 'api';
    case NetworkName.BNBChain:
      return 'bsc.api';
    case NetworkName.Polygon:
      return 'polygon.api';
    case NetworkName.Arbitrum:
      return 'arbitrum.api';
    case NetworkName.PolygonMumbai:
      return 'mumbai.api';
    case NetworkName.ArbitrumGoerli:
    case NetworkName.Hardhat:
    case NetworkName.EthereumSepolia:
    case NetworkName.EthereumGoerli_DEPRECATED:
    case NetworkName.EthereumRopsten_DEPRECATED:
      throw new Error(`No 0x API URL for chain ${networkName}`);
  }
};

const zeroXApiUrl = (networkName: NetworkName): string => {
  return `https://${zeroXApiSubdomain(networkName)}.0x.org`;
};

const paramString = (params?: APIParams) => {
  if (!params) {
    return '';
  }
  const searchParams = new URLSearchParams(params);
  return searchParams.toString() ? `?${searchParams.toString()}` : '';
};

export const createZeroXUrlAndHeaders = (
  endpoint: ZeroXApiEndpoint,
  networkName: NetworkName,
  isRailgun: boolean,
  params?: APIParams,
) => {
  const proxyDomain = ZeroXConfig.PROXY_API_DOMAIN;
  if (isDefined(proxyDomain) && proxyDomain.length > 0) {
    return {
      url: createZeroXProxyAPIUrl(
        proxyDomain,
        endpoint,
        networkName,
        isRailgun,
        params,
      ),
      headers: {},
    };
  }
  const apiKey = ZeroXConfig.API_KEY;
  if (isDefined(apiKey) && apiKey.length > 0) {
    const url = `${zeroXApiUrl(networkName)}/${endpoint}${paramString(params)}`;
    return { url, headers: { '0x-api-key': apiKey } };
  }
  throw new Error(
    'No 0x proxy domain or API Key configured. Set ZeroXConfig.PROXY_API_DOMAIN or ZeroXConfig.API_KEY. For tests, modify test-config-overrides.test.ts.',
  );
};

const createZeroXProxyAPIUrl = (
  proxyDomain: string,
  endpoint: ZeroXApiEndpoint,
  networkName: NetworkName,
  isRailgun: boolean,
  params?: APIParams,
) => {
  const route = isRailgun ? 'railgun' : 'public';
  const url = `${proxyDomain}/0x/${route}/${zeroXApiSubdomain(
    networkName,
  )}/${endpoint}${paramString(params)}`;
  return url;
};

export const getZeroXData = async <T>(
  endpoint: ZeroXApiEndpoint,
  networkName: NetworkName,
  isRailgun: boolean,
  params?: APIParams,
): Promise<T> => {
  const { url, headers } = createZeroXUrlAndHeaders(
    endpoint,
    networkName,
    isRailgun,
    params,
  );
  const rsp = await axios.get(url, { headers });
  return rsp.data;
};
