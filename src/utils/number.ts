import { BigNumber } from 'ethers';

export const minBalanceAfterSlippage = (
  balance: BigNumber,
  slippagePercentage: number,
): BigNumber => {
  return balance.mul(10000 - slippagePercentage * 10000).div(10000);
};
