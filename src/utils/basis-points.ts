export const numToBasisPoints = (num: Optional<number>): bigint => {
  return BigInt((num ?? 0) * 10000);
};
