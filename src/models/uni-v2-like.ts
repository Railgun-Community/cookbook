import { UniswapV2Fork } from './export-models';

export type LiquidityV2Pool = {
  name: string;
  uniswapV2Fork: UniswapV2Fork;
  tokenAddressA: string;
  tokenSymbolA: string;
  tokenDecimalsA: bigint;
  tokenAddressB: string;
  tokenSymbolB: string;
  tokenDecimalsB: bigint;
  pairAddress: string;
  pairTokenName: string;
  pairTokenSymbol: string;
  pairTokenDecimals: bigint;
  rateWith18Decimals: bigint;
};
