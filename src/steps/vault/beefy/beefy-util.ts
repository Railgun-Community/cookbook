import { BigNumber } from '@ethersproject/bignumber';

export const calculateOutputsForBeefyDeposit = (
  stepInitialBalance: BigNumber,
  depositFee: number,
  decimals: number,
  vaultRate: string,
) => {
  const depositFeeBasisPoints = BigNumber.from(depositFee * 10000);
  const depositFeeAmount = BigNumber.from(stepInitialBalance)
    .mul(depositFeeBasisPoints)
    .div(10000);
  const depositAmountAfterFee = stepInitialBalance.sub(depositFeeAmount);

  const decimalsAdjustment = BigNumber.from(10).pow(decimals);
  const receivedVaultTokenAmount = BigNumber.from(depositAmountAfterFee)
    .mul(decimalsAdjustment)
    .div(vaultRate);

  return {
    depositFeeAmount,
    depositAmountAfterFee,
    receivedVaultTokenAmount,
  };
};

export const calculateOutputsForBeefyWithdraw = (
  stepInitialBalance: BigNumber,
  withdrawFee: number,
  decimals: number,
  vaultRate: string,
) => {
  const decimalsAdjustment = BigNumber.from(10).pow(decimals);
  const receivedWithdrawAmount = BigNumber.from(stepInitialBalance)
    .mul(vaultRate)
    .div(decimalsAdjustment);

  const withdrawFeeBasisPoints = BigNumber.from(withdrawFee * 10000);
  const withdrawFeeAmount = BigNumber.from(receivedWithdrawAmount)
    .mul(withdrawFeeBasisPoints)
    .div(10000);
  const withdrawAmountAfterFee = receivedWithdrawAmount.sub(withdrawFeeAmount);

  return { receivedWithdrawAmount, withdrawFeeAmount, withdrawAmountAfterFee };
};
