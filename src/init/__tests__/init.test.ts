import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { initCookbook } from '../init';
import { RailgunConfig } from '../../models/railgun-config';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('init', () => {
  it('Should run init script', async () => {
    initCookbook('35', '40');
    expect(RailgunConfig.SHIELD_FEE_BASIS_POINTS).to.equal('35');
    expect(RailgunConfig.UNSHIELD_FEE_BASIS_POINTS).to.equal('40');
  });
});
