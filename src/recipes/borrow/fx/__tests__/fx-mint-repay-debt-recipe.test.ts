import chai from 'chai';
import { FxMintRepayDebtRecipe } from '../fx-mint-repay-debt-recipe';

const { expect } = chai;

describe('FxMintRepayDebtRecipe', () => {
  const baseOpts = {
    positionId: 1903n,
    repayAmount: 3_000_000_000_000_000_000n, // 3 fxUSD
    approveAmount: 3_006_000_000_000_000_000n, // = 3e18 × (1e9 + 2e6) / 1e9 (mainnet's 0.2% repay fee)
    repayFeeRatio: 2_000_000n, // mainnet repay fee
  };

  it('constructs for wstETH-Long', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
        }),
    ).not.to.throw();
  });

  it('constructs for WBTC-Long (pool-agnostic)', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'WBTC-Long',
        }),
    ).not.to.throw();
  });

  it('throws if repayAmount is 0', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          repayAmount: 0n,
        }),
    ).to.throw(/repayAmount/i);
  });

  it('throws if repayAmount is negative', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          repayAmount: -1n,
        }),
    ).to.throw(/repayAmount/i);
  });

  it('throws if approveAmount < repayAmount (caller forgot fee uplift)', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          repayAmount: 3_000_000_000_000_000_000n,
          approveAmount: 2_500_000_000_000_000_000n, // less than repay — bug
        }),
    ).to.throw(/approveAmount.*repayAmount|computeFxRepay/i);
  });

  it('throws if approveAmount diverges from the fee-uplifted target (strict equality)', () => {
    expect(
      () =>
        new FxMintRepayDebtRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          repayAmount: 3_000_000_000_000_000_000n,
          // > repayAmount but != repayAmount × (FEE_DENOM + repayFeeRatio) / FEE_DENOM.
          // PoolManager pulls the exact uplifted amount via transferFrom;
          // an over-approve still trips the step-validator's balanced
          // accounting. Strict equality keeps the error close to the cause.
          approveAmount: 3_100_000_000_000_000_000n,
        }),
    ).to.throw(/computeFxRepay/i);
  });
});
