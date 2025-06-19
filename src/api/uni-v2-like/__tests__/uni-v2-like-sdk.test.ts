import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { UniV2LikeSDK } from '../uni-v2-like-sdk';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';
import { JsonRpcProvider } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6n,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18n,
};

let provider: JsonRpcProvider;

describe('uni-v2-like-pairs', () => {
  before(() => {
    provider = new JsonRpcProvider('https://eth.llamarpc.com');
  });

  it('Should get Uniswap LP address for USDC-WETH pair', async () => {
    const lpAddress = UniV2LikeSDK.getPairLPAddress(
      UniswapV2Fork.Uniswap,
      networkName,
      USDC_TOKEN,
      WETH_TOKEN,
    );
    expect(lpAddress).to.equal('0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc');
  });

  it('Should get Uniswap LP rate for USDC-WETH pair', async () => {
    const rate = await UniV2LikeSDK.getPairRateWith18Decimals(
      UniswapV2Fork.Uniswap,
      networkName,
      provider,
      USDC_TOKEN,
      WETH_TOKEN,
    );

    const oneWithDecimals = 10n ** 18n;

    expect(rate > oneWithDecimals * 500n).to.equal(
      true,
      'Expected USDC-WETH LP rate to be greater than 500',
    );
    expect(rate < oneWithDecimals * 5000n).to.equal(
      true,
      'Expected USDC-WETH LP rate to be less than 5000',
    );
  }).timeout(5000);
});
