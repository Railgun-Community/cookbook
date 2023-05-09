import { BigNumber } from 'ethers';
import { RailgunConfig } from '../models/railgun-config';
import { NetworkName } from '@railgun-community/shared-models';

export const getUnshieldFee = (
  networkName: NetworkName,
  preUnshieldAmount: BigNumber,
): BigNumber => {
  const unshieldFeeBasisPoints =
    RailgunConfig.getUnshieldFeeBasisPoints(networkName);
  return preUnshieldAmount.mul(unshieldFeeBasisPoints).div(10000);
};

export const getUnshieldedAmountAfterFee = (
  networkName: NetworkName,
  preUnshieldAmount: BigNumber,
): BigNumber => {
  const fee = getUnshieldFee(networkName, preUnshieldAmount);
  return preUnshieldAmount.sub(fee);
};

export const getAmountToUnshieldForTarget = (
  networkName: NetworkName,
  postUnshieldAmount: BigNumber,
) => {
  const unshieldFeeBasisPoints =
    RailgunConfig.getUnshieldFeeBasisPoints(networkName);
  return postUnshieldAmount.mul(10000).div(10000 - unshieldFeeBasisPoints);
};

export const getShieldFee = (
  networkName: NetworkName,
  preShieldAmount: BigNumber,
): BigNumber => {
  const shieldFeeBasisPoints =
    RailgunConfig.getShieldFeeBasisPoints(networkName);
  return preShieldAmount.mul(shieldFeeBasisPoints).div(10000);
};

export const getShieldedAmountAfterFee = (
  networkName: NetworkName,
  preShieldAmount: BigNumber,
): BigNumber => {
  const fee = getShieldFee(networkName, preShieldAmount);
  return preShieldAmount.sub(fee);
};
