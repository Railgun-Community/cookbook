import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { initCookbook } from '../index';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('index', () => {
  it('Should load index', async () => {
    expect(initCookbook).to.be.a('function');
  });
});
