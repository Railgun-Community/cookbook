import { BigNumber } from '@ethersproject/bignumber';

export type PairDataWithRate = {
  tokenAddressA: string;
  tokenSymbolA: string;
  tokenDecimalsA: number;
  tokenAddressB: string;
  tokenSymbolB: string;
  tokenDecimalsB: number;
  pairAddress: string;
  rateWith18Decimals: BigNumber;
};
