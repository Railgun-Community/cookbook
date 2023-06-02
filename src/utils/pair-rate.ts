const DECIMALS_18 = 10n ** 18n;

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
