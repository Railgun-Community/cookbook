import { RailgunConfig } from '../models/railgun-config';

export const initCookbook = (
  shieldFeeBasisPoints: string,
  unshieldFeeBasisPoints: string,
) => {
  RailgunConfig.SHIELD_FEE_BASIS_POINTS = shieldFeeBasisPoints;
  RailgunConfig.UNSHIELD_FEE_BASIS_POINTS = unshieldFeeBasisPoints;
};
