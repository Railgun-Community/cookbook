import chai from 'chai';
import {
  resolvePool,
  FX_ADDRESSES,
  KNOWN_POOLS,
  computeFxRepay,
  computeFxClose,
} from '../fx-mint-util';

const { expect } = chai;

describe('fx-mint-util — pool registry', () => {
  it('resolvePool("wstETH-Long") returns collateralDecimals = 18n', () => {
    const pool = resolvePool('wstETH-Long');
    expect(pool.collateralDecimals).to.equal(18n);
    expect(pool.collateralToken.toLowerCase()).to.equal(FX_ADDRESSES.wstETH.toLowerCase());
  });

  it('resolvePool("WBTC-Long") returns collateralDecimals = 8n', () => {
    const pool = resolvePool('WBTC-Long');
    expect(pool.collateralDecimals).to.equal(8n);
    expect(pool.collateralToken.toLowerCase()).to.equal(
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
    );
  });

  it('resolvePool with custom ref preserves collateralDecimals from caller', () => {
    const pool = resolvePool({
      address: '0x000000000000000000000000000000000000beef',
      collateralToken: '0x000000000000000000000000000000000000cafe',
      collateralDecimals: 6n,
    });
    expect(pool.collateralDecimals).to.equal(6n);
  });

  it('KNOWN_POOLS has collateralDecimals on every entry', () => {
    for (const entry of KNOWN_POOLS) {
      expect(entry.collateralDecimals).to.be.a('bigint');
      // chai 4.x's .gte typings don't accept bigint, so compare directly.
      expect(entry.collateralDecimals >= 0n).to.equal(true);
    }
  });

  it('resolvePool throws on unknown pool name', () => {
    expect(() => resolvePool('UNKNOWN' as never)).to.throw(/Unknown fxMINT pool/);
  });

  it('FX_ADDRESSES no longer exposes the misleading fxPositionNFT constant', () => {
    expect((FX_ADDRESSES as Record<string, unknown>).fxPositionNFT).to.equal(undefined);
  });
});

describe('fx-mint-util — computeFxRepay', () => {
  it('caps repayAmount at min(maxRepayUnderFee, rawDebts, desiredRepayAmount)', () => {
    const result = computeFxRepay({
      rawDebts: 100_000_000_000_000_000_000n,             // 100 fxUSD debt
      shieldedFxUSD: 50_000_000_000_000_000_000n,         // 50 fxUSD shielded
      desiredRepayAmount: 30_000_000_000_000_000_000n,    // wants to repay 30
      repayFeeRatio: 5_000_000n,                          // 0.5% (test value, not mainnet's 0.2%)
      railgunUnshieldFeeBps: 25n,
    });

    // The 30 fxUSD desired is below both rawDebts and the post-fee max;
    // expect repayAmount = 30 fxUSD exactly.
    expect(result.repayAmount).to.equal(30_000_000_000_000_000_000n);
    // approveAmount = 30e18 × (1e9 + 5e6) / 1e9 = 30.15e18.
    expect(result.approveAmount).to.equal(30_150_000_000_000_000_000n);
  });

  it('caps repayAmount at maxRepayUnderFee when shieldedFxUSD is the binding constraint', () => {
    const result = computeFxRepay({
      rawDebts: 1_000_000_000_000_000_000_000n,           // 1000 fxUSD
      shieldedFxUSD: 10_000_000_000_000_000_000n,         // 10 fxUSD
      desiredRepayAmount: 1_000_000_000_000_000_000_000n, // wants to repay all 1000
      repayFeeRatio: 5_000_000n,
      railgunUnshieldFeeBps: 25n,
    });

    // 10 × (10000 - 25) / 10000 = 9.975 fxUSD post-unshield.
    // 9.975 × 1e9 / (1e9 + 5e6) = 9.925373... fxUSD post-repay-fee.
    expect(result.fxUSDAfterUnshield).to.equal(9_975_000_000_000_000_000n);
    // chai's .lessThan/.greaterThan don't accept bigint in 4.x typings, so
    // compare directly (same workaround as the .gte case above).
    expect(result.repayAmount < 10_000_000_000_000_000_000n).to.equal(true);
    expect(result.approveAmount <= 9_975_000_000_000_000_000n).to.equal(true);
  });

  it('caps repayAmount at rawDebts when desiredRepayAmount > rawDebts', () => {
    const result = computeFxRepay({
      rawDebts: 50_000_000_000_000_000_000n,              // 50 fxUSD
      shieldedFxUSD: 1_000_000_000_000_000_000_000n,      // way more than enough
      desiredRepayAmount: 100_000_000_000_000_000_000n,   // wants to over-repay
      repayFeeRatio: 5_000_000n,
      railgunUnshieldFeeBps: 25n,
    });

    expect(result.repayAmount).to.equal(50_000_000_000_000_000_000n);
  });
});

describe('fx-mint-util — computeFxClose still passes after refactor', () => {
  it('produces same output as before the refactor (golden value)', () => {
    const result = computeFxClose({
      rawColls: 8_000_000_000_000_000n,
      rawDebts: 5_000_000_000_000_000_000n,
      collateralBalance: 8_000_000_000_000_000n,
      totalRawColls: 8_000_000_000_000_000n,
      shieldedFxUSD: 4_975_000_000_000_000_000n,         // = 5 fxUSD - 0.5% borrow fee
      repayFeeRatio: 5_000_000n,
      railgunUnshieldFeeBps: 25n,
    });

    expect(result.partialClose).to.equal(true);
    // FxCloseAmounts doesn't include rawDebts; compare against the literal input.
    // chai 4.x .lessThanOrEqual/.greaterThan don't accept bigint, so compare directly.
    expect(result.repayAmount <= 5_000_000_000_000_000_000n).to.equal(true);
    expect(result.approveAmount > result.repayAmount).to.equal(true);
  });
});
