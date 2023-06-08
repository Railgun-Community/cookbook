import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getRandomNFTID } from '../token';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('token', () => {
  it('Should get random NFT ID', async () => {
    const randomNFTID = getRandomNFTID();
    expect(randomNFTID).to.be.a('bigint');
    expect(randomNFTID.toString(16).length).to.equal(64);
  });
});
