import { NetworkName } from '@railgun-community/shared-models';
import { createZeroXUrlAndHeaders, ZeroXApiEndpoint } from '../zero-x-fetch';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXConfig } from '../../../models/zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('zero-x-fetch', () => {
  before(() => {
    ZeroXConfig.API_KEY = 'test-api-key';
  });
  after(() => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = undefined;
  });

  it('Should create correct ZeroX URLs', async () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    expect(
      createZeroXUrlAndHeaders(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.Ethereum,
        true,
        {
          something: 'new',
          another: 'thing',
        },
      ),
    ).to.deep.equal({
      url: 'https://api.0x.org/swap/v1/quote?something=new&another=thing',
      headers: { '0x-api-key': 'test-api-key' },
    });
    expect(
      createZeroXUrlAndHeaders(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.PolygonMumbai,
        true,
      ),
    ).to.deep.equal({
      url: 'https://mumbai.api.0x.org/swap/v1/quote',
      headers: { '0x-api-key': 'test-api-key' },
    });

    ZeroXConfig.PROXY_API_DOMAIN = 'testapi.com';
    expect(
      createZeroXUrlAndHeaders(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.Ethereum,
        true,
        {
          something: 'new',
          another: 'thing',
        },
      ),
    ).to.deep.equal({
      url: 'testapi.com/0x/railgun/api/swap/v1/quote?something=new&another=thing',
      headers: {},
    });
    expect(
      createZeroXUrlAndHeaders(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.PolygonMumbai,
        false,
      ),
    ).to.deep.equal({
      url: 'testapi.com/0x/public/mumbai.api/swap/v1/quote',
      headers: {},
    });
  });
});
