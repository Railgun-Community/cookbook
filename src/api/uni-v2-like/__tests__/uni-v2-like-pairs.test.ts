import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import {
  queryAllLPPairsForTokenAddressesPerFork,
  getCachedLPPairsForTokenAddresses,
  getLPPairsForTokenAddresses,
} from '../uni-v2-like-pairs';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';
import { JsonRpcProvider } from 'ethers';
import { PairDataWithRate } from '../../../models';

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

const assertValidSushiSwapUSDCWethPair = (pair: PairDataWithRate) => {
  const oneWithDecimals = 10n ** 18n;
  const rate = pair.rateWith18Decimals;
  expect(rate > oneWithDecimals * 500n).to.equal(
    true,
    'Expected USDC-WETH LP rate to be greater than 500',
  );
  expect(rate < oneWithDecimals * 5000n).to.equal(
    true,
    'Expected USDC-WETH LP rate to be less than 5000',
  );

  // @ts-expect-error - Remove for obj comparison.
  delete pair.rateWith18Decimals;

  expect(pair).to.deep.equal({
    uniswapV2Fork: 'SushiSwap',
    tokenAddressA: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    tokenAddressB: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    tokenDecimalsA: 6n,
    tokenDecimalsB: 18n,
    tokenSymbolA: 'USDC',
    tokenSymbolB: 'WETH',
    pairAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
    pairTokenName: 'SushiSwap USDC/WETH LP',
    pairTokenSymbol: 'USDC/WETH LP',
    pairTokenDecimals: 18n,
  });
};

let provider: JsonRpcProvider;

describe('uni-v2-like-pairs', () => {
  before(() => {
    provider = new JsonRpcProvider('https://rpc.ankr.com/eth');
  });

  it('Should get Uniswap LP pairs for USDC and WETH', async () => {
    const pairsOnlyUSDC = await queryAllLPPairsForTokenAddressesPerFork(
      UniswapV2Fork.Uniswap,
      networkName,
      [USDC_TOKEN.tokenAddress],
    );
    expect(pairsOnlyUSDC.length).to.equal(0);

    const pairsUSDCAndWeth = await queryAllLPPairsForTokenAddressesPerFork(
      UniswapV2Fork.Uniswap,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);

    const oneWithDecimals = 10n ** 18n;
    const rate = pairsUSDCAndWeth[0].rateWith18Decimals;
    expect(rate > oneWithDecimals * 500n).to.equal(
      true,
      'Expected USDC-WETH LP rate to be greater than 500',
    );
    expect(rate < oneWithDecimals * 5000n).to.equal(
      true,
      'Expected USDC-WETH LP rate to be less than 5000',
    );

    // @ts-expect-error - Remove for obj comparison.
    delete pairsUSDCAndWeth[0].rateWith18Decimals;

    expect(pairsUSDCAndWeth[0]).to.deep.equal({
      uniswapV2Fork: 'Uniswap',
      pairAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
      tokenAddressA: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenAddressB: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenDecimalsA: 6n,
      tokenDecimalsB: 18n,
      tokenSymbolA: 'USDC',
      tokenSymbolB: 'WETH',
      pairTokenName: 'Uniswap USDC/WETH LP',
      pairTokenSymbol: 'USDC/WETH LP',
      pairTokenDecimals: 18n,
    });
  }).timeout(30000);

  it('Should get SushiSwap LP pairs for USDC and WETH', async () => {
    const pairsOnlyUSDC = await queryAllLPPairsForTokenAddressesPerFork(
      UniswapV2Fork.SushiSwap,
      networkName,
      [USDC_TOKEN.tokenAddress],
    );
    expect(pairsOnlyUSDC.length).to.equal(0);

    const pairsUSDCAndWeth = await queryAllLPPairsForTokenAddressesPerFork(
      UniswapV2Fork.SushiSwap,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);
    assertValidSushiSwapUSDCWethPair(pairsUSDCAndWeth[0]);
  }).timeout(5000);

  it('Should get cached LP pairs for USDC and WETH', async () => {
    const pairsOnlyUSDC = await getCachedLPPairsForTokenAddresses(
      provider,
      networkName,
      [USDC_TOKEN.tokenAddress],
    );
    expect(pairsOnlyUSDC.length).to.equal(0);

    const pairsUSDCAndWeth = await getCachedLPPairsForTokenAddresses(
      provider,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);
    assertValidSushiSwapUSDCWethPair(pairsUSDCAndWeth[0]);
  }).timeout(5000);

  it('Should get LP pairs for USDC and WETH (returns first option from cache)', async () => {
    const pairsUSDCAndWeth = await getLPPairsForTokenAddresses(
      provider,
      networkName,
      [USDC_TOKEN.tokenAddress, WETH_TOKEN.tokenAddress],
    );
    expect(pairsUSDCAndWeth.length).to.equal(1);
    assertValidSushiSwapUSDCWethPair(pairsUSDCAndWeth[0]);
  }).timeout(5000);
});
