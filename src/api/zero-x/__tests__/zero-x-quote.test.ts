import { NetworkName } from '@railgun-community/shared-models';
import { ZeroXQuote } from '../zero-x-quote';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../../models/export-models';

import { ZeroXConfig } from '../../../models/zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

describe('zero-x-quote', () => {
  before(() => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
  });

  it('Should fetch quotes from ZeroX proxy', async () => {
    const sellERC20Amount: RecipeERC20Amount = {
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      decimals: 18n,
      isBaseToken: false,
      amount: BigInt('0x1000000000000000000'),
    };
    const buyERC20Info: RecipeERC20Info = {
      tokenAddress: 'DAI',
      decimals: 18n,
      isBaseToken: false,
    };

    const quote = await ZeroXQuote.getSwapQuote({
      networkName,
      sellERC20Amount,
      buyERC20Info,
      slippagePercentage: 0.01,
      isRailgun: true,
    });

    expect(typeof quote === 'object').to.be.true;
    expect(quote).to.haveOwnProperty('price');
    expect(quote).to.haveOwnProperty('spender');
    expect(quote).to.haveOwnProperty('sellTokenValue');
  }).timeout(10000);
});
