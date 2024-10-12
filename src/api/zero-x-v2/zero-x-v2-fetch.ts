import { isDefined } from '@railgun-community/shared-models';
import { ZeroXConfig } from '../../models';
import axios from 'axios';

type SearchParams = Record<string, any>;

export enum ZeroXV2ApiEndpoint {
  GetSwapQuote = 'swap/allowance-holder/quote',
  GetSwapPrice = 'swap/allowance-holder/price',
}

const ZERO_X_V2_BASE_URL = 'https://api.0x.org/';

const getSearchV2Params = (params?: SearchParams) => {
  const searchParams = new URLSearchParams(params);
  return searchParams.toString() ? `?${searchParams.toString()}` : '';
};

const createZeroXV2Url = (
  endpoint: ZeroXV2ApiEndpoint,
  params?: SearchParams,
) => {
  return `${ZERO_X_V2_BASE_URL}${endpoint}${getSearchV2Params(params)}`;
};

const createV2Headers = () => {
  const apiKey = ZeroXConfig.API_KEY;
  if (isDefined(apiKey) && apiKey.length > 0) {
    return {
      '0x-api-key': apiKey,
      '0x-version': 'v2',
    };
  }
  throw new Error(
    'No 0x API Key is configured. Set ZeroXConfig.API_KEY. For tests, modify test-config-overrides.test.ts.',
  );
};

export const createZeroXV2UrlAndHeaders = (
  endpoint: ZeroXV2ApiEndpoint,
  isRailgun: boolean,
  params?: SearchParams,
) => {
  const proxyDomain = ZeroXConfig.PROXY_API_DOMAIN;
  if (isDefined(proxyDomain) && proxyDomain.length > 0) {
    return {
      url: createZeroXV2ProxyAPIUrl(proxyDomain, endpoint, isRailgun, params),
      headers: {},
    };
  }
  const url = createZeroXV2Url(endpoint, params);
  const headers = createV2Headers();
  return {
    url,
    headers,
  };
};

export const createZeroXV2ProxyAPIUrl = (
  proxyDomain: string,
  endpoint: ZeroXV2ApiEndpoint,
  isRailgun: boolean,
  params?: SearchParams,
) => {
  // this is unused for now, need to check 0x proxy code.
  const route = isRailgun ? 'railgun' : 'public';
  const url = `${proxyDomain}/0x/${route}/api/${endpoint}${getSearchV2Params(
    params,
  )}`;
  return url;
};

export const getZeroXV2Data = async <T>(
  endpoint: ZeroXV2ApiEndpoint,
  isRailgun: boolean,
  params?: SearchParams,
): Promise<T> => {
  const { url, headers } = createZeroXV2UrlAndHeaders(
    endpoint,
    isRailgun,
    params,
  );
  //   console.log('url', url);
  //   console.log('headers', headers);
  const response = await axios.get(url, { headers }).catch(error => {
    console.log('error', JSON.stringify(error.response.data.data.details[0]));
    return undefined;
  });
  // handle errors here.?
  //   console.log('response', response);
  return response?.data;
};

// handle errors
const handleZeroXV2Error = (error: unknown) => {};
