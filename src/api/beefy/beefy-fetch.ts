import axios from 'axios';

export enum BeefyApiEndpoint {
  GetVaults = 'vaults',
  GetFees = 'fees',
  GetAPYs = 'apy',
}

const BEEFY_API_URL = 'https://api.beefy.finance';

export const getBeefyAPIData = async <T>(
  endpoint: BeefyApiEndpoint,
): Promise<T> => {
  const url = `${BEEFY_API_URL}/${endpoint}`;
  const rsp = await axios.get(url);
  return rsp.data;
};
