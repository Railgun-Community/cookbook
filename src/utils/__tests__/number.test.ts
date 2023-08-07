import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { numToPlainString } from '../number';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('number', () => {
  it('Should convert exponential number to plain text', async () => {
    expect(numToPlainString(1234567890123456)).to.equal('1234567890123456');
    expect(numToPlainString(0.0000000000123)).to.equal('0.0000000000123');
    expect(numToPlainString('4.01149413241532790875582e+23')).to.equal(
      '401149413241532800000000', // NOTE: Loses precision
    );
  });
});
