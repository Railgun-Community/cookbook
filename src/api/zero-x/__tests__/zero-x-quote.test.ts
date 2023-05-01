import { NetworkName } from '@railgun-community/shared-models';
import { zeroXGetSwapQuote } from '../zero-x-quote';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../../models/export-models';
import { BigNumber } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('zero-x-quote', () => {
  before(() => {});

  it('Should fetch quotes from ZeroX proxy', async () => {
    const sellERC20Amount: RecipeERC20Amount = {
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      isBaseToken: false,
      amount: BigNumber.from('0x1000000000000000000'),
    };
    const buyERC20Info: RecipeERC20Info = {
      tokenAddress: 'DAI',
      isBaseToken: false,
    };

    const quote = await zeroXGetSwapQuote({
      networkName: NetworkName.Ethereum,
      sellERC20Amount,
      buyERC20Info,
      slippagePercentage: 0.01,
    });

    expect(typeof quote === 'object').to.be.true;
    expect(quote).to.haveOwnProperty('price');
    expect(quote).to.haveOwnProperty('spender');
    expect(quote).to.haveOwnProperty('sellTokenValue');
  }).timeout(10000);
});
