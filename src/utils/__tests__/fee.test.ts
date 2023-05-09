import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
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
    const postUnshieldAmount = BigNumber.from('19949999999999999');

    const targetUnshieldAmount = getAmountToUnshieldForTarget(
      networkName,
      postUnshieldAmount,
    );
    expect(targetUnshieldAmount.toString()).to.equal('19999999999999998');

    const unshieldedAmount = getUnshieldedAmountAfterFee(
      NetworkName.Ethereum,
      targetUnshieldAmount,
    );
    expect(unshieldedAmount.toString()).to.equal('19949999999999999');
  });
});
