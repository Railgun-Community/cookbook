import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { setRailgunFees } from '../init';
import { RailgunConfig } from '../../models/railgun-config';
import { NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('init', () => {
  it('Should run init script', async () => {
    setRailgunFees(NetworkName.Arbitrum, 35n, 40n);
    expect(
      RailgunConfig.SHIELD_FEE_BASIS_POINTS_FOR_NETWORK[NetworkName.Arbitrum],
    ).to.equal(35n);
    expect(
      RailgunConfig.UNSHIELD_FEE_BASIS_POINTS_FOR_NETWORK[NetworkName.Arbitrum],
    ).to.equal(40n);
  });
});
