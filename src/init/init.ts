import { NetworkName } from '@railgun-community/shared-models';
import { CookbookDebugger } from '../models/export-models';
import { RailgunConfig } from '../models/railgun-config';
import { CookbookDebug } from '../utils/cookbook-debug';

export const setRailgunFees = (
  networkName: NetworkName,
  shieldFeeBasisPoints: bigint,
  unshieldFeeBasisPoints: bigint,
) => {
  RailgunConfig.SHIELD_FEE_BASIS_POINTS_FOR_NETWORK[networkName] =
    shieldFeeBasisPoints;
  RailgunConfig.UNSHIELD_FEE_BASIS_POINTS_FOR_NETWORK[networkName] =
    unshieldFeeBasisPoints;
};

export const setCookbookDebugger = (cookbookDebugger: CookbookDebugger) => {
  CookbookDebug.setDebugger(cookbookDebugger);
};
