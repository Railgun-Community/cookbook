import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { calculatePairRateWith18Decimals } from '../pair-rate';

chai.use(chaiAsPromised);
const { expect } = chai;

const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

const oneInDecimals6 = BigNumber.from(10).pow(6);
const oneInDecimals18 = BigNumber.from(10).pow(18);

const reserveA = oneInDecimals6.mul(2000);
const reserveB = oneInDecimals18.mul(1);

describe('pair-rate', () => {
  it('Should get pair-rate for LP token pair', async () => {
    const pairRate = calculatePairRateWith18Decimals(
      reserveA,
      USDC_DECIMALS,
      reserveB,
      WETH_DECIMALS,
    );
    expect(pairRate.toString()).to.equal(oneInDecimals18.mul(2000).toString());
  });
});
