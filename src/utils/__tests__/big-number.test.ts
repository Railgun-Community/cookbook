import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { babylonianSqrt } from '../big-number';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('big-number', () => {
  it('Should get babylonian square root', async () => {
    expect(babylonianSqrt(0n)).to.equal(0n);
    expect(babylonianSqrt(1n)).to.equal(1n);
    expect(babylonianSqrt(4n)).to.equal(2n);
    expect(babylonianSqrt(9n)).to.equal(3n);
    expect(babylonianSqrt(100n)).to.equal(10n);

    expect(babylonianSqrt(48293757902093n)).to.equal(6949371n);
    expect(babylonianSqrt(7388840002838n)).to.equal(2718242n);
    expect(babylonianSqrt(8327636263626362639238923n)).to.equal(2885764415822n);
    expect(babylonianSqrt(99999999999999999999999999n)).to.equal(
      9999999999999n,
    );
    expect(babylonianSqrt(822614601784652458980823543363n)).to.equal(
      906981037169274n,
    );
  });
});
