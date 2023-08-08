import { UniswapV2Fork } from './export-models';

export type PairDataWithRate = {
  uniswapV2Fork: UniswapV2Fork;
  tokenAddressA: string;
  tokenSymbolA: string;
  tokenDecimalsA: bigint;
  tokenAddressB: string;
  tokenSymbolB: string;
  tokenDecimalsB: bigint;
  pairAddress: string;
  rateWith18Decimals: bigint;
};
