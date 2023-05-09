import { BigNumber } from 'ethers';

export const minBalanceAfterSlippage = (
  balance: BigNumber,
  slippagePercentage: number,
): BigNumber => {
  const slippageMax = balance.mul(slippagePercentage * 10000).div(10000);
  return balance.sub(slippageMax);
};
