import { RailgunConfig } from '../models/railgun-config';
import { NetworkName } from '@railgun-community/shared-models';

export const getUnshieldFee = (
  networkName: NetworkName,
  preUnshieldAmount: bigint,
): bigint => {
  const unshieldFeeBasisPoints =
    RailgunConfig.getUnshieldFeeBasisPoints(networkName);
  return (preUnshieldAmount * unshieldFeeBasisPoints) / 10000n;
};

export const getUnshieldedAmountAfterFee = (
  networkName: NetworkName,
  preUnshieldAmount: bigint,
): bigint => {
  const fee = getUnshieldFee(networkName, preUnshieldAmount);
  return preUnshieldAmount - fee;
};

export const getAmountToUnshieldForTarget = (
  networkName: NetworkName,
  postUnshieldAmount: bigint,
) => {
  const unshieldFeeBasisPoints =
    RailgunConfig.getUnshieldFeeBasisPoints(networkName);
  return (postUnshieldAmount * 10000n) / (10000n - unshieldFeeBasisPoints);
};

export const getShieldFee = (
  networkName: NetworkName,
  preShieldAmount: bigint,
): bigint => {
  const shieldFeeBasisPoints =
    RailgunConfig.getShieldFeeBasisPoints(networkName);
  return (preShieldAmount * shieldFeeBasisPoints) / 10000n;
};

export const getShieldedAmountAfterFee = (
  networkName: NetworkName,
  preShieldAmount: bigint,
): bigint => {
  const fee = getShieldFee(networkName, preShieldAmount);
  return preShieldAmount - fee;
};
