import { BEEFY_VAULT_ERC20_DECIMALS, BeefyVaultData } from '../../../api';

export const calculateOutputsForBeefyDeposit = (
  stepInitialBalance: bigint,
  vault: BeefyVaultData,
) => {
  const { vaultRate, depositFeeBasisPoints } = vault;

  const depositFeeAmount =
    (stepInitialBalance * depositFeeBasisPoints) / 10000n;
  const depositAmountAfterFee = stepInitialBalance - depositFeeAmount;

  const vaultERC20DecimalsAdjustment =
    10n ** BigInt(BEEFY_VAULT_ERC20_DECIMALS);

  const receivedVaultTokenAmount =
    (depositAmountAfterFee * vaultERC20DecimalsAdjustment) / vaultRate;

  return {
    depositFeeAmount,
    depositAmountAfterFee,
    receivedVaultTokenAmount,
  };
};

export const calculateOutputsForBeefyWithdraw = (
  stepInitialBalance: bigint,
  vault: BeefyVaultData,
) => {
  const { vaultRate, withdrawFeeBasisPoints } = vault;

  const vaultERC20DecimalsAdjustment =
    10n ** BigInt(BEEFY_VAULT_ERC20_DECIMALS);

  const receivedWithdrawAmount =
    (stepInitialBalance * vaultRate) / vaultERC20DecimalsAdjustment;

  const withdrawFeeAmount =
    (receivedWithdrawAmount * withdrawFeeBasisPoints) / 10000n;
  const withdrawAmountAfterFee = receivedWithdrawAmount - withdrawFeeAmount;

  return {
    receivedWithdrawAmount,
    withdrawFeeAmount,
    withdrawAmountAfterFee,
  };
};
