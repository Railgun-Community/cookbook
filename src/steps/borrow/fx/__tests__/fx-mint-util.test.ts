import chai from 'chai';
import { resolvePool, FX_ADDRESSES, KNOWN_POOLS } from '../fx-mint-util';

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
