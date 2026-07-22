import { NetworkName, NETWORK_CONFIG } from '@railgun-community/shared-models';
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

// EIP-7702 execution account (ephemeral EOA). 0x must send bought tokens here
// (quote `taker`) instead of the relay-adapt contract the legacy flow baked in.
const RECIPIENT = '0x1111111111111111111111111111111111111111';

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
    recipient: RECIPIENT,
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
  
    const getZeroXV2DataStub = sinon.stub(zeroXV2Api, 'getZeroXV2Data').resolves({
      liquidityAvailable: false,
      // Add other necessary properties to match the expected response structure
    });

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

    try {
      await ZeroXV2Quote.getSwapQuote({
        networkName,
        sellERC20Amount,
        buyERC20Info,
        slippageBasisPoints: 100,
        isRailgun: true,
        recipient: RECIPIENT,
      });
    } catch(err) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(err.cause).to.contain(noLiquidityErrMessage);
    } finally {
      getZeroXV2DataStub.restore();
    }
  });

  it('Should route 0x taker/txOrigin to the provided recipient (EIP-7702, no relay-adapt)', () => {
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

    const params = ZeroXV2Quote.getQuoteParams(
      networkName,
      sellERC20Amount,
      buyERC20Info,
      100,
      RECIPIENT,
    );

    // The bought tokens must go to the executing ephemeral EOA — not the
    // relay-adapt contract the legacy flow baked in from NETWORK_CONFIG.
    expect(params.taker).to.equal(RECIPIENT);
    expect(params.txOrigin).to.equal(RECIPIENT);
    const relayAdaptContract =
      NETWORK_CONFIG[networkName].relayAdaptContract.toLowerCase();
    expect(params.taker.toLowerCase()).to.not.equal(relayAdaptContract);
  });

  it('Should reject an invalid or zero recipient (EIP-7702)', () => {
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

    // Zero address (would burn the bought tokens) and a malformed address must
    // both fail loud rather than silently misroute.
    expect(() =>
      ZeroXV2Quote.getQuoteParams(
        networkName,
        sellERC20Amount,
        buyERC20Info,
        100,
        '0x0000000000000000000000000000000000000000',
      ),
    ).to.throw();
    expect(() =>
      ZeroXV2Quote.getQuoteParams(
        networkName,
        sellERC20Amount,
        buyERC20Info,
        100,
        'not-an-address',
      ),
    ).to.throw();
  });
})