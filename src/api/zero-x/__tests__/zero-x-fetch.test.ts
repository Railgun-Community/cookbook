import { NetworkName } from '@railgun-community/shared-models';
import { createZeroXUrl, ZeroXApiEndpoint } from '../zero-x-fetch';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('zero-x-fetch', () => {
  before(() => {});

  it('Should create correct ZeroX URLs', async () => {
    expect(
      createZeroXUrl(ZeroXApiEndpoint.GetSwapQuote, NetworkName.Ethereum, {
        something: 'new',
        another: 'thing',
      }),
    ).to.equal('https://api.0x.org/swap/v1/quote?something=new&another=thing');
    expect(
      createZeroXUrl(ZeroXApiEndpoint.GetSwapQuote, NetworkName.PolygonMumbai),
    ).to.equal('https://mumbai.api.0x.org/swap/v1/quote');
  });
});
