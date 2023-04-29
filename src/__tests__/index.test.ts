import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { initConfig } from '../index';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('index', () => {
  it('Should load index', async () => {
    expect(initConfig).to.be.a('function');
  });
});
