import { NetworkName } from '@railgun-community/shared-models';
import { ZeroXV2Quote } from '../zero-x-v2-quote';
import * as zeroXV2Api from '../zero-x-v2-fetch';
import chai from 'chai';
import sinon from 'sinon';
import chaiAsPromised from 'chai-as-promised';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../../models/export-models';
import { ZeroXConfig } from '../../../models/zero-x-config';
import { testConfig } from '../../../test/test-config.test';
import { NoLiquidityError } from '../errors';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const runV2QuoteTest = async (amount = '1000000000000000000') => {
  const sellERC20Amount: RecipeERC20Amount = {
    tokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
    decimals: 18n,
    isBaseToken: false,
    amount: BigInt(amount),
  };
  const buyERC20Info: RecipeERC20Info = {
    tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    decimals: 18n,
    isBaseToken: false,
  };

  const quote = await ZeroXV2Quote.getSwapQuote({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints: 100,
    isRailgun: true,
  });

  expect(typeof quote === 'object').to.be.true;
  expect(quote).to.haveOwnProperty('price');
  expect(quote).to.haveOwnProperty('spender');
  expect(quote).to.haveOwnProperty('sellTokenValue');
};

describe('zero-x-v2-quote', () => {
  let getZeroXV2DataStub: sinon.SinonStub;
  before(() => {});
  
  
  beforeEach(() => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = testConfig.zeroXApiKey;

    getZeroXV2DataStub = sinon.stub(zeroXV2Api, 'getZeroXV2Data');
  });

  afterEach(() => {
    getZeroXV2DataStub.restore();
  });


  it('Should fetch quotes from ZeroXV2 proxy', async () => {
    ZeroXConfig.PROXY_API_DOMAIN = testConfig.zeroXProxyApiDomain;
    ZeroXConfig.API_KEY = undefined;
    await runV2QuoteTest();
  }).timeout(10000);

  it('Should fetch quotes from ZeroXV2 API Key', async () => {
    await runV2QuoteTest();
  }).timeout(10000);

  it('Should fetch quotes from ZeroXV2 API Key with large volume request', async () => {
    await runV2QuoteTest('0x1000000000000000000000');
  }).timeout(10000);

  it('Should fetch quotes from ZeroXV2 API Key with large volume request and fail', async () => {

    await expect(runV2QuoteTest('0x10000000000000000000000000000000000000000'))
      .to.be.rejected;
  }).timeout(10000);

  it('Should error with no liquidity error when theres no liquidity for trade on ZeroXV2 API', async () => {
  
    const noLiquidityErrMessage = new NoLiquidityError().getCause();

    const sellERC20Amount: RecipeERC20Amount = {
      tokenAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
      decimals: 18n,
      isBaseToken: false,
      amount: BigInt('1000000000000000000'),
    };

    const buyERC20Info: RecipeERC20Info = {
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      decimals: 18n,
      isBaseToken: false,
    };

    getZeroXV2DataStub.resolves({
      liquidityAvailable: false,
    });

    try {
      await ZeroXV2Quote.getSwapQuote({
        networkName,
        sellERC20Amount,
        buyERC20Info,
        slippageBasisPoints: 100,
        isRailgun: true,
      });
    } catch(err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(err.cause).to.contain(noLiquidityErrMessage);
    }
  });
})