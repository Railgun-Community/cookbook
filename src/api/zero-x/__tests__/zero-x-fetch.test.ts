import { NetworkName } from '@railgun-community/shared-models';
import { createZeroXUrl, ZeroXApiEndpoint } from '../zero-x-fetch';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXConfig } from '../../../models/zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('zero-x-fetch', () => {
  before(() => {});

  it('Should create correct ZeroX URLs', async () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;

    expect(
      createZeroXUrl(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.Ethereum,
        true,
        {
          something: 'new',
          another: 'thing',
        },
      ),
    ).to.equal('https://api.0x.org/swap/v1/quote?something=new&another=thing');
    expect(
      createZeroXUrl(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.PolygonMumbai,
        true,
      ),
    ).to.equal('https://mumbai.api.0x.org/swap/v1/quote');

    ZeroXConfig.PROXY_API_DOMAIN = 'testapi.com';

    expect(
      createZeroXUrl(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.Ethereum,
        true,
        {
          something: 'new',
          another: 'thing',
        },
      ),
    ).to.equal(
      'testapi.com/0x/railgun/api/swap/v1/quote?something=new&another=thing',
    );
    expect(
      createZeroXUrl(
        ZeroXApiEndpoint.GetSwapQuote,
        NetworkName.PolygonMumbai,
        false,
      ),
    ).to.equal('testapi.com/0x/public/mumbai.api/swap/v1/quote');
  });
});
