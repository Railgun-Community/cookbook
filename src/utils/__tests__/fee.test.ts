import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { NetworkName } from '@railgun-community/shared-models';
import {
  getAmountToUnshieldForTarget,
  getUnshieldedAmountAfterFee,
} from '../fee';
import { setRailgunFees } from '../../init';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

describe('fee', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should get target unshield amount after reverse fee calc', async () => {
    const postUnshieldAmount = BigInt('19949999999999999');

    const targetUnshieldAmount = getAmountToUnshieldForTarget(
      networkName,
      postUnshieldAmount,
    );
    expect(targetUnshieldAmount).to.equal(19999999999999998n);

    const unshieldedAmount = getUnshieldedAmountAfterFee(
      NetworkName.Ethereum,
      targetUnshieldAmount,
    );
    expect(unshieldedAmount).to.equal(19949999999999999n);
  });
});
