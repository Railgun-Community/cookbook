import { BEEFY_VAULT_ERC20_DECIMALS } from '../../../api';

export const calculateOutputsForBeefyDeposit = (
  stepInitialBalance: bigint,
  depositFeeBasisPoints: bigint,
  depositERC20Decimals: bigint,
  vaultRate: bigint,
) => {
  const depositFeeAmount =
    (stepInitialBalance * depositFeeBasisPoints) / 10000n;
  const depositAmountAfterFee = stepInitialBalance - depositFeeAmount;

  const depositERC20DecimalsAdjustment = 10n ** BigInt(depositERC20Decimals);
  const vaultERC20DecimalsAdjustment =
    10n ** BigInt(BEEFY_VAULT_ERC20_DECIMALS);
  const decimalQuotient =
    vaultERC20DecimalsAdjustment / depositERC20DecimalsAdjustment;

  const receivedVaultTokenAmount =
    (depositAmountAfterFee * vaultERC20DecimalsAdjustment * decimalQuotient) /
    vaultRate;

  return {
    depositFeeAmount,
    depositAmountAfterFee,
    receivedVaultTokenAmount,
  };
};

export const calculateOutputsForBeefyWithdraw = (
  stepInitialBalance: bigint,
  withdrawFeeBasisPoints: bigint,
  depositERC20Decimals: bigint,
  vaultRate: bigint,
) => {
  const depositERC20DecimalsAdjustment = 10n ** BigInt(depositERC20Decimals);
  const vaultERC20DecimalsAdjustment =
    10n ** BigInt(BEEFY_VAULT_ERC20_DECIMALS);
  const decimalQuotient =
    vaultERC20DecimalsAdjustment / depositERC20DecimalsAdjustment;

  const receivedWithdrawAmount =
    (stepInitialBalance * vaultRate) /
    decimalQuotient /
    vaultERC20DecimalsAdjustment;

  const withdrawFeeAmount =
    (receivedWithdrawAmount * withdrawFeeBasisPoints) / 10000n;
  const withdrawAmountAfterFee = receivedWithdrawAmount - withdrawFeeAmount;

  return { receivedWithdrawAmount, withdrawFeeAmount, withdrawAmountAfterFee };
};
