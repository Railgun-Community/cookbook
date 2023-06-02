export const babylonianSqrt = (y: bigint): bigint => {
  let z = 0n;
  if (y > 3n) {
    z = y;
    let x = y / 2n + 1n;
    while (x < z) {
      z = x;
      x = (y / x + x) / 2n;
    }
  } else if (y > 0) {
    z = 1n;
  }
  return z;
};

export const maxBigNumber = (b1: bigint, b2: bigint) => {
  return b1 > b2 ? b1 : b2;
};

export const minBigNumber = (b1: bigint, b2: bigint) => {
  return b1 < b2 ? b1 : b2;
};

export const maxBigNumberForTransaction = (): bigint => {
  return 2n ** 256n - 1n;
};
