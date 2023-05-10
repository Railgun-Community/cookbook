import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { babylonianSqrt } from '../big-number';
import { BigNumber } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('big-number', () => {
  it('Should get babylonian square root', async () => {
    expect(babylonianSqrt(BigNumber.from(0)).toString()).to.equal('0');
    expect(babylonianSqrt(BigNumber.from(1)).toString()).to.equal('1');
    expect(babylonianSqrt(BigNumber.from(4)).toString()).to.equal('2');
    expect(babylonianSqrt(BigNumber.from(9)).toString()).to.equal('3');
    expect(babylonianSqrt(BigNumber.from(100)).toString()).to.equal('10');

    expect(
      babylonianSqrt(BigNumber.from('48293757902093')).toString(),
    ).to.equal('6949371');
    expect(babylonianSqrt(BigNumber.from('7388840002838')).toString()).to.equal(
      '2718242',
    );
    expect(
      babylonianSqrt(BigNumber.from('8327636263626362639238923')).toString(),
    ).to.equal('2885764415822');
    expect(
      babylonianSqrt(BigNumber.from('99999999999999999999999999')).toString(),
    ).to.equal('9999999999999');
    expect(
      babylonianSqrt(
        BigNumber.from('822614601784652458980823543363'),
      ).toString(),
    ).to.equal('906981037169274');
  });
});
