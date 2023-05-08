import { BigNumber } from '@ethersproject/bignumber';

export const calculatePairRateWith18Decimals = (
  tokenAmountA: BigNumber,
  tokenDecimalsA: number,
  tokenAmountB: BigNumber,
  tokenDecimalsB: number,
) => {
  const decimals18 = BigNumber.from(10).pow(18);
  const decimalsA = BigNumber.from(10).pow(tokenDecimalsA);
  const decimalsB = BigNumber.from(10).pow(tokenDecimalsB);

  const rateWith18Decimals = tokenAmountA
    .mul(decimals18)
    .mul(decimalsB)
    .div(tokenAmountB)
    .div(decimalsA);
  return rateWith18Decimals;
};
