export const minBalanceAfterSlippage = (
  balance: bigint,
  slippageBasisPoints: bigint,
): bigint => {
  const slippageMax = (balance * slippageBasisPoints) / 10000n;
  return balance - slippageMax;
};
