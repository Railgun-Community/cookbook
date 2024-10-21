import { NetworkName } from '@railgun-community/shared-models';
import {
  createZeroXV2UrlAndHeaders,
  ZeroXV2ApiEndpoint,
} from '../zero-x-v2-fetch';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXConfig } from '../../../models/zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;
const NULL_SPENDER_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('zero-x-v2-fetch', () => {
  before(() => {
    ZeroXConfig.API_KEY = 'test-api-key';
  });
  after(() => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = undefined;
  });

  it('Should create correct ZeroXV2 URLs', async () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    expect(
      createZeroXV2UrlAndHeaders(ZeroXV2ApiEndpoint.GetSwapQuote, true, {
        chainId: '1',
        sellAmount: '100000000000000000000',
        buyToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      }),
    ).to.deep.equal({
      url: 'https://api.0x.org/swap/allowance-holder/quote?chainId=1&sellAmount=100000000000000000000&buyToken=0x6b175474e89094c44da98b954eedeac495271d0f&sellToken=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      headers: { '0x-api-key': 'test-api-key', '0x-version': 'v2' },
    });
    expect(
      createZeroXV2UrlAndHeaders(ZeroXV2ApiEndpoint.GetSwapQuote, true),
    ).to.deep.equal({
      url: 'https://api.0x.org/swap/allowance-holder/quote',
      headers: { '0x-api-key': 'test-api-key', '0x-version': 'v2' },
    });

    ZeroXConfig.PROXY_API_DOMAIN = 'testapi.com';
    expect(
      createZeroXV2UrlAndHeaders(ZeroXV2ApiEndpoint.GetSwapQuote, true, {
        chainId: '1',
        sellAmount: '100000000000000000000',
        buyToken: '0x6b175474e89094c44da98b954eedeac495271d0f',
        sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        taker: NULL_SPENDER_ADDRESS, // this needs to be added in by network, it will be the 'relay adapt contract' ie the contract sending the tx
      }),
    ).to.deep.equal({
      url:
        'testapi.com/0x/railgun/api/swap/allowance-holder/quote?chainId=1&sellAmount=100000000000000000000&buyToken=0x6b175474e89094c44da98b954eedeac495271d0f&sellToken=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2&taker=' +
        NULL_SPENDER_ADDRESS,
      headers: {},
    });
    expect(
      createZeroXV2UrlAndHeaders(ZeroXV2ApiEndpoint.GetSwapQuote, false),
    ).to.deep.equal({
      url: 'testapi.com/0x/public/api/swap/allowance-holder/quote',
      headers: {},
    });
  });
});
