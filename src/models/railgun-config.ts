import { NetworkName } from '@railgun-community/shared-models';

export class RailgunConfig {
  static SHIELD_FEE_BASIS_POINTS_FOR_NETWORK: Record<string, string> = {};
  static UNSHIELD_FEE_BASIS_POINTS_FOR_NETWORK: Record<string, string> = {};

  static getShieldFeeBasisPoints = (networkName: NetworkName): number => {
    const shieldFee = this.SHIELD_FEE_BASIS_POINTS_FOR_NETWORK[networkName];
    if (!shieldFee) {
      throw new Error(`No shield fee defined for network ${networkName}.`);
    }
    return Number(shieldFee);
  };

  static getUnshieldFeeBasisPoints = (networkName: NetworkName): number => {
    const unshieldFee = this.UNSHIELD_FEE_BASIS_POINTS_FOR_NETWORK[networkName];
    if (!unshieldFee) {
      throw new Error(`No unshield fee defined for network ${networkName}.`);
    }
    return Number(unshieldFee);
  };
}
