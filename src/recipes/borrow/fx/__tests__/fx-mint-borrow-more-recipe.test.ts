import chai from 'chai';
import { FxMintBorrowMoreRecipe } from '../fx-mint-borrow-more-recipe';

const { expect } = chai;

describe('FxMintBorrowMoreRecipe', () => {
  const baseOpts = {
    positionId: 1903n,
    additionalDebt: 5_000_000_000_000_000_000n,
    borrowFeeRatio: 5_000_000n,
  };

  it('constructs for wstETH-Long (no swap leg, no validatePoolFlow involvement)', () => {
    expect(
      () =>
        new FxMintBorrowMoreRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
        }),
    ).not.to.throw();
  });

  it('constructs for WBTC-Long (same — pool-agnostic)', () => {
    expect(
      () =>
        new FxMintBorrowMoreRecipe({
          ...baseOpts,
          pool: 'WBTC-Long',
        }),
    ).not.to.throw();
  });

  it('throws if additionalDebt is 0', () => {
    expect(
      () =>
        new FxMintBorrowMoreRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          additionalDebt: 0n,
        }),
    ).to.throw(/additionalDebt/i);
  });

  it('throws if additionalDebt is negative', () => {
    expect(
      () =>
        new FxMintBorrowMoreRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          additionalDebt: -1n,
        }),
    ).to.throw(/additionalDebt/i);
  });
});
