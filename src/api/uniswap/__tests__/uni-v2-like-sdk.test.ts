import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { UniV2LikeSDK } from '../uni-v2-like-sdk';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';
import { JsonRpcProvider } from '@ethersproject/providers';
import { BigNumber } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18,
};

let provider: JsonRpcProvider;

describe('uni-v2-like-sdk', () => {
  before(() => {
    provider = new JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/demo');
  });

  it('Should get Uniswap LP address for USDC-WETH pair', async () => {
    const lpAddress = UniV2LikeSDK.getPairLPAddress(
      UniswapV2Fork.Uniswap,
      networkName,
      USDC_TOKEN,
      WETH_TOKEN,
    );
    expect(lpAddress).to.equal('0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc');
  });

  it('Should get Uniswap LP rate for USDC-WETH pair', async () => {
    const rate = await UniV2LikeSDK.getPairRateWith18Decimals(
      UniswapV2Fork.Uniswap,
      networkName,
      provider,
      USDC_TOKEN,
      WETH_TOKEN,
    );

    const oneWithDecimals = BigNumber.from(10).pow(18);

    expect(rate.gt(oneWithDecimals.mul(500))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be greater than 500',
    );
    expect(rate.lt(oneWithDecimals.mul(5000))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be less than 5000',
    );
  }).timeout(5000);

  it('Should get Uniswap LP pairs for USDC and WETH', async () => {
    const pairsOnlyUSDC = await UniV2LikeSDK.getAllLPPairsForTokenAddresses(
      UniswapV2Fork.Uniswap,
      networkName,
      [USDC_TOKEN.tokenAddress],
    );
    expect(pairsOnlyUSDC.length).to.equal(0);

    const pairsUSDCAndWeth = await UniV2LikeSDK.getAllLPPairsForTokenAddresses(
      UniswapV2Fork.Uniswap,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);

    const oneWithDecimals = BigNumber.from(10).pow(18);
    const rate = pairsUSDCAndWeth[0].rateWith18Decimals;
    expect(rate.gt(oneWithDecimals.mul(500))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be greater than 500',
    );
    expect(rate.lt(oneWithDecimals.mul(5000))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be less than 5000',
    );

    // @ts-expect-error - Remove for obj comparison.
    delete pairsUSDCAndWeth[0].rateWith18Decimals;

    expect(pairsUSDCAndWeth[0]).to.deep.equal({
      pairAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
      tokenAddressA: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenAddressB: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenDecimalsA: 6,
      tokenDecimalsB: 18,
      tokenSymbolA: 'USDC',
      tokenSymbolB: 'WETH',
    });
  }).timeout(15000);

  it('Should get Sushiswap LP pairs for USDC and WETH', async () => {
    const pairsOnlyUSDC = await UniV2LikeSDK.getAllLPPairsForTokenAddresses(
      UniswapV2Fork.Sushiswap,
      networkName,
      [USDC_TOKEN.tokenAddress],
    );
    expect(pairsOnlyUSDC.length).to.equal(0);

    const pairsUSDCAndWeth = await UniV2LikeSDK.getAllLPPairsForTokenAddresses(
      UniswapV2Fork.Sushiswap,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);

    const oneWithDecimals = BigNumber.from(10).pow(18);
    const rate = pairsUSDCAndWeth[0].rateWith18Decimals;
    expect(rate.gt(oneWithDecimals.mul(500))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be greater than 500',
    );
    expect(rate.lt(oneWithDecimals.mul(5000))).to.equal(
      true,
      'Expected USDC-WETH LP rate to be less than 5000',
    );

    // @ts-expect-error - Remove for obj comparison.
    delete pairsUSDCAndWeth[0].rateWith18Decimals;

    expect(pairsUSDCAndWeth[0]).to.deep.equal({
      pairAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
      tokenAddressA: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenAddressB: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenDecimalsA: 6,
      tokenDecimalsB: 18,
      tokenSymbolA: 'USDC',
      tokenSymbolB: 'WETH',
    });
  }).timeout(5000);
});
