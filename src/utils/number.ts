export const minBalanceAfterSlippage = (
  balance: bigint,
  slippagePercentage: number,
): bigint => {
  const slippageMax = (balance * BigInt(slippagePercentage * 10000)) / 10000n;
  return balance - slippageMax;
};

/**
 * JavaScript converts 0.0000000001 to scientific notation when parsed to a string.
 * This avoid that automatic conversion.
 * NOTE: Loses precision - max precision is 20.
 */
export const numToPlainString = (num: number | string): string => {
  if (typeof num === 'string') {
    return numToPlainString(Number(num));
  }

  // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
  return ('' + +num).replace(
    /(-?)(\d*)\.?(\d*)e([+-]\d+)/,
    function (a, b, c, d, e) {
      return e < 0
        ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-plus-operands
          b + '0.' + Array(1 - e - c.length).join('0') + c + d
        : // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-plus-operands
          b + c + d + Array(e - d.length + 1).join('0');
    },
  );
};
