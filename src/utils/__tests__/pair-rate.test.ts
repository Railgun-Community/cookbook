import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { calculatePairRateWith18Decimals } from '../pair-rate';

chai.use(chaiAsPromised);
const { expect } = chai;

const USDC_DECIMALS = 6n;
const WETH_DECIMALS = 18n;

const oneInDecimals6 = 10n ** 6n;
const oneInDecimals18 = 10n ** 18n;

const reserveA = oneInDecimals6 * 2000n;
const reserveB = oneInDecimals18 * 1n;

describe('pair-rate', () => {
  it('Should get pair-rate for LP token pair', async () => {
    const pairRate = calculatePairRateWith18Decimals(
      reserveA,
      USDC_DECIMALS,
      reserveB,
      WETH_DECIMALS,
    );
    expect(pairRate).to.equal(oneInDecimals18 * 2000n);
  });
});
