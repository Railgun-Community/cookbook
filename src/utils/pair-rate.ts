import { BigNumber } from '@ethersproject/bignumber';

const DECIMALS_18 = BigNumber.from(10).pow(18);

export const calculatePairRateWith18Decimals = (
  reserveA: BigNumber,
  tokenDecimalsA: number,
  reserveB: BigNumber,
  tokenDecimalsB: number,
) => {
  const decimalsA = BigNumber.from(10).pow(tokenDecimalsA);
  const decimalsB = BigNumber.from(10).pow(tokenDecimalsB);

  const rateWith18Decimals = reserveA
    .mul(DECIMALS_18)
    .mul(decimalsB)
    .div(reserveB)
    .div(decimalsA);
  return rateWith18Decimals;
};

export const calculateAmountBFromPairRate = (
  amountA: BigNumber,
  tokenDecimalsA: number,
  tokenDecimalsB: number,
  rateWith18Decimals: BigNumber,
) => {
  const decimalsA = BigNumber.from(10).pow(tokenDecimalsA);
  const decimalsB = BigNumber.from(10).pow(tokenDecimalsB);

  const amountB = amountA
    .mul(DECIMALS_18)
    .mul(decimalsB)
    .div(rateWith18Decimals)
    .div(decimalsA);
  return amountB;
};
