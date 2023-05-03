import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { setRailgunFees } from '../index';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('index', () => {
  it('Should load index', async () => {
    expect(setRailgunFees).to.be.a('function');
  });
});
