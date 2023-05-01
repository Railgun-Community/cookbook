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
    const sellTokenAmount: RecipeERC20Amount = {
      tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      isBaseToken: false,
      amount: BigNumber.from('0x1000000000000000000'),
    };
    const buyToken: RecipeERC20Info = {
      tokenAddress: 'DAI',
      isBaseToken: false,
    };

    const { quote, error } = await zeroXGetSwapQuote({
      networkName: NetworkName.Ethereum,
      sellTokenAmount,
      buyToken,
      slippagePercentage: 0.01,
    });

    expect(error).to.be.undefined;
    expect(typeof quote === 'object').to.be.true;
  });
});
