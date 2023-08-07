export const minBalanceAfterSlippage = (
  balance: bigint,
  slippagePercentage: number,
): bigint => {
  const slippageMax = (balance * BigInt(slippagePercentage * 10000)) / 10000n;
  return balance - slippageMax;
};
