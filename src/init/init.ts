import { CookbookDebugger } from '../models/export-models';
import { RailgunConfig } from '../models/railgun-config';
import { CookbookDebug } from '../utils/cookbook-debug';

export const initCookbook = (
  shieldFeeBasisPoints: string,
  unshieldFeeBasisPoints: string,
  cookbookDebugger?: CookbookDebugger,
) => {
  RailgunConfig.SHIELD_FEE_BASIS_POINTS = shieldFeeBasisPoints;
  RailgunConfig.UNSHIELD_FEE_BASIS_POINTS = unshieldFeeBasisPoints;

  if (cookbookDebugger) {
    CookbookDebug.setDebugger(cookbookDebugger);
  }
};
