export const calculateOutputsForBeefyDeposit = (
  stepInitialBalance: bigint,
  depositFeeBasisPoints: bigint,
  decimals: bigint,
  vaultRate: bigint,
) => {
  const depositFeeAmount =
    (stepInitialBalance * depositFeeBasisPoints) / 10000n;
  const depositAmountAfterFee = stepInitialBalance - depositFeeAmount;

  const decimalsAdjustment = 10n ** BigInt(decimals);
  const receivedVaultTokenAmount =
    (depositAmountAfterFee * decimalsAdjustment) / vaultRate;

  return {
    depositFeeAmount,
    depositAmountAfterFee,
    receivedVaultTokenAmount,
  };
};

export const calculateOutputsForBeefyWithdraw = (
  stepInitialBalance: bigint,
  withdrawFeeBasisPoints: bigint,
  decimals: bigint,
  vaultRate: bigint,
) => {
  const decimalsAdjustment = 10n ** BigInt(decimals);
  const receivedWithdrawAmount =
    (stepInitialBalance * vaultRate) / decimalsAdjustment;

  const withdrawFeeAmount =
    (receivedWithdrawAmount * withdrawFeeBasisPoints) / 10000n;
  const withdrawAmountAfterFee = receivedWithdrawAmount - withdrawFeeAmount;

  return { receivedWithdrawAmount, withdrawFeeAmount, withdrawAmountAfterFee };
};
