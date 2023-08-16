import { UniswapV2Fork } from '../models';

const DECIMALS_18 = 10n ** 18n;

export const getPairTokenDecimals = () => {
  return 18n;
};

export const calculatePairRateWith18Decimals = (
  reserveA: bigint,
  tokenDecimalsA: bigint,
  reserveB: bigint,
  tokenDecimalsB: bigint,
) => {
  const decimalsA = 10n ** tokenDecimalsA;
  const decimalsB = 10n ** tokenDecimalsB;

  const rateWith18Decimals =
    (reserveA * DECIMALS_18 * decimalsB) / reserveB / decimalsA;
  return rateWith18Decimals;
};

export const getLPPoolName = (
  uniswapV2Fork: UniswapV2Fork,
  tokenSymbolA: string,
  tokenSymbolB: string,
) => {
  return `${uniswapV2Fork} V2 ${tokenSymbolA}/${tokenSymbolB}`;
};

export const getLPPairTokenName = (
  uniswapV2Fork: UniswapV2Fork,
  tokenSymbolA: string,
  tokenSymbolB: string,
) => {
  return `${uniswapV2Fork} ${tokenSymbolA}/${tokenSymbolB} LP`;
};

export const getLPPairTokenSymbol = (
  tokenSymbolA: string,
  tokenSymbolB: string,
) => {
  return `${tokenSymbolA}/${tokenSymbolB} LP`;
};
