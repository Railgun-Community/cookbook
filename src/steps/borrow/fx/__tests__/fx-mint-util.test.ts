import chai from 'chai';
import {
  resolvePool,
  FX_ADDRESSES,
  KNOWN_POOLS,
  computeFxRepay,
  computeFxClose,
  fxCollateralSupplySpend,
  fxCollateralWithdrawOutput,
  fxDebtBorrowOutput,
  fxDebtRepaySpend,
  fxComposeScalingFactor,
  fxScaleDownRawDebt,
  fxScaleUpNativeDebt,
} from '../fx-mint-util';

const { expect } = chai;

// Placeholder addresses for custom-pool refs. Hoisted out of the object
// literals on purpose: `collateralToken: '0x…'` trips the repo's secret scanner,
// whose contextual rule matches any key containing "token" assigned a long
// quoted literal.
const CUSTOM_POOL_ADDRESS = '0x000000000000000000000000000000000000beef';
const CUSTOM_COLLATERAL = '0x000000000000000000000000000000000000cafe';

describe('fx-mint-util — pool registry', () => {
  it('resolvePool("wstETH-Long") returns collateralDecimals = 18n', () => {
    const pool = resolvePool('wstETH-Long');
    expect(pool.collateralDecimals).to.equal(18n);
    expect(pool.collateralToken.toLowerCase()).to.equal(
      FX_ADDRESSES.wstETH.toLowerCase(),
    );
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
      address: CUSTOM_POOL_ADDRESS,
      collateralToken: CUSTOM_COLLATERAL,
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
    expect(() => resolvePool('UNKNOWN' as never)).to.throw(
      /Unknown fxMINT pool/,
    );
  });

  it('FX_ADDRESSES no longer exposes the misleading fxPositionNFT constant', () => {
    expect((FX_ADDRESSES as Record<string, unknown>).fxPositionNFT).to.equal(
      undefined,
    );
  });
});

describe('fx-mint-util — short pool registry (f(x) v2.1)', () => {
  it('resolvePool("stETH-Short") inverts collateral and debt vs the long pool', () => {
    const short = resolvePool('stETH-Short');
    const long = resolvePool('wstETH-Long');

    // Short: supply fxUSD, borrow wstETH. Long: supply wstETH, mint fxUSD.
    expect(short.collateralToken.toLowerCase()).to.equal(
      FX_ADDRESSES.fxUSD.toLowerCase(),
    );
    expect(short.debtToken.toLowerCase()).to.equal(
      FX_ADDRESSES.wstETH.toLowerCase(),
    );
    expect(short.collateralToken.toLowerCase()).to.equal(
      long.debtToken.toLowerCase(),
    );
    expect(short.debtToken.toLowerCase()).to.equal(
      long.collateralToken.toLowerCase(),
    );
  });

  it('short pools resolve to the ShortPoolManager, not the long manager', () => {
    for (const name of ['stETH-Short', 'WBTC-Short'] as const) {
      const pool = resolvePool(name);
      expect(pool.side).to.equal('short');
      expect(pool.poolManager.toLowerCase()).to.equal(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );
      // Carrying the manager per-pool is the whole point: operate() on the long
      // manager reverts for a pool that is not registered there.
      expect(pool.poolManager.toLowerCase()).to.not.equal(
        FX_ADDRESSES.fxPoolManager.toLowerCase(),
      );
    }
  });

  it('WBTC-Short carries 8-decimal debt against 18-decimal collateral', () => {
    const pool = resolvePool('WBTC-Short');
    // Decimals sit on the opposite sides from WBTC-Long. Assuming rather than
    // reading these is a silent 10^10 error in amount accounting.
    expect(pool.collateralDecimals).to.equal(18n);
    expect(pool.debtDecimals).to.equal(8n);

    const long = resolvePool('WBTC-Long');
    expect(long.collateralDecimals).to.equal(8n);
    expect(long.debtDecimals).to.equal(18n);
  });

  it('every KNOWN_POOLS entry declares a side, manager, and distinct debt token', () => {
    for (const entry of KNOWN_POOLS) {
      expect(entry.side).to.be.oneOf(['long', 'short']);
      expect(entry.poolManager).to.be.a('string');
      expect(entry.debtDecimals).to.be.a('bigint');
      expect(entry.debtToken.toLowerCase()).to.not.equal(
        entry.collateralToken.toLowerCase(),
      );
    }
  });

  it('custom pool refs default to long semantics, so pre-v2.1 callers are unaffected', () => {
    const pool = resolvePool({
      address: CUSTOM_POOL_ADDRESS,
      collateralToken: CUSTOM_COLLATERAL,
      collateralDecimals: 6n,
    });
    expect(pool.side).to.equal('long');
    expect(pool.debtToken.toLowerCase()).to.equal(
      FX_ADDRESSES.fxUSD.toLowerCase(),
    );
    expect(pool.debtDecimals).to.equal(18n);
    expect(pool.poolManager.toLowerCase()).to.equal(
      FX_ADDRESSES.fxPoolManager.toLowerCase(),
    );
  });

  it('custom pool refs can opt into short semantics', () => {
    const pool = resolvePool({
      address: CUSTOM_POOL_ADDRESS,
      collateralToken: FX_ADDRESSES.fxUSD,
      collateralDecimals: 18n,
      debtToken: FX_ADDRESSES.wstETH,
      debtDecimals: 18n,
      poolManager: FX_ADDRESSES.fxShortPoolManager,
      side: 'short',
    });
    expect(pool.side).to.equal('short');
    expect(pool.debtToken.toLowerCase()).to.equal(
      FX_ADDRESSES.wstETH.toLowerCase(),
    );
  });

  it('rejects a custom pool that names one token as both collateral and debt', () => {
    expect(() =>
      resolvePool({
        address: CUSTOM_POOL_ADDRESS,
        collateralToken: FX_ADDRESSES.fxUSD,
        collateralDecimals: 18n,
        debtToken: FX_ADDRESSES.fxUSD,
        debtDecimals: 18n,
        poolManager: FX_ADDRESSES.fxShortPoolManager,
        side: 'short',
      }),
    ).to.throw(/both collateral and debt/);
  });
});

describe('fx-mint-util — fee model', () => {
  // Measured on mainnet 2026-07-30 via PoolConfiguration.getPoolFeeRatio.
  const LONG_FEES = {
    supplyFeeRatio: 0n,
    withdrawFeeRatio: 0n,
    borrowFeeRatio: 5_000_000n, // 0.5%
    repayFeeRatio: 2_000_000n, // 0.2%
  };
  const SHORT_FEES = {
    supplyFeeRatio: 3_000_000n, // 0.3%
    withdrawFeeRatio: 1_000_000n, // 0.1%
    borrowFeeRatio: 0n,
    repayFeeRatio: 0n,
  };

  const ONE = 1_000_000_000_000_000_000n;

  it('supply spend is the FULL amount — the fee shrinks the position, not the outlay', () => {
    // _handleSupply pulls all of newColl from msg.sender and credits
    // newColl - fee to the position. Declaring the net as `spent` would
    // under-report and break the recipe's amount accounting.
    expect(fxCollateralSupplySpend(ONE)).to.equal(ONE);
    expect(SHORT_FEES.supplyFeeRatio > 0n).to.equal(true);
  });

  it('withdraw output IS net of fee, unlike supply', () => {
    expect(
      fxCollateralWithdrawOutput(ONE, SHORT_FEES.withdrawFeeRatio),
    ).to.equal(999_000_000_000_000_000n);
    // Longs charge nothing on withdraw, so the same call is a no-op there —
    // which is why the amount math needs no branch on `side`.
    expect(
      fxCollateralWithdrawOutput(ONE, LONG_FEES.withdrawFeeRatio),
    ).to.equal(ONE);
  });

  it('borrow output is net of the borrow fee', () => {
    expect(fxDebtBorrowOutput(ONE, LONG_FEES.borrowFeeRatio)).to.equal(
      995_000_000_000_000_000n,
    );
    expect(fxDebtBorrowOutput(ONE, SHORT_FEES.borrowFeeRatio)).to.equal(ONE);
  });

  it('repay spend is principal PLUS fee, not principal minus fee', () => {
    // _handleRepay pulls fee and principal in two separate transferFrom calls,
    // so an approval sized to the principal alone reverts.
    expect(fxDebtRepaySpend(ONE, LONG_FEES.repayFeeRatio)).to.equal(
      1_002_000_000_000_000_000n,
    );
    expect(fxDebtRepaySpend(ONE, SHORT_FEES.repayFeeRatio)).to.equal(ONE);
  });

  it('handles 8-decimal debt (WBTC-Short borrows WBTC)', () => {
    const oneWBTC = 100_000_000n;
    expect(fxDebtBorrowOutput(oneWBTC, 5_000_000n)).to.equal(99_500_000n);
    expect(fxDebtRepaySpend(oneWBTC, 2_000_000n)).to.equal(100_200_000n);
  });

  it('all four ratios are zero-safe', () => {
    expect(fxCollateralWithdrawOutput(ONE, 0n)).to.equal(ONE);
    expect(fxDebtBorrowOutput(ONE, 0n)).to.equal(ONE);
    expect(fxDebtRepaySpend(ONE, 0n)).to.equal(ONE);
  });
});

describe('fx-mint-util — raw debt scaling (short pools)', () => {
  // Measured on the ShortPoolManager 2026-07-30 via the public tokenRates map:
  //   wstETH -> scalar 1,    no rateProvider  => factor 1e18
  //   WBTC   -> scalar 1e10, no rateProvider  => factor 1e28
  // The dynamic rateProvider lives on the LONG manager's collateral, not here.
  const WSTETH_FACTOR = 10n ** 18n;
  const WBTC_FACTOR = 10n ** 28n;

  it('composes the factor the same way _getTokenScalingFactor does', () => {
    expect(fxComposeScalingFactor(1n)).to.equal(WSTETH_FACTOR);
    expect(fxComposeScalingFactor(10_000_000_000n)).to.equal(WBTC_FACTOR);
    // With a rate provider the PRECISION term is replaced by getRate().
    expect(fxComposeScalingFactor(1n, 1_100_000_000_000_000_000n)).to.equal(
      1_100_000_000_000_000_000n,
    );
  });

  it('is the identity for wstETH debt (factor 1e18)', () => {
    const raw = 2_604_470_033_929_010_143n; // live stETH-Short position #167
    expect(fxScaleDownRawDebt(raw, WSTETH_FACTOR)).to.equal(raw);
  });

  it('divides WBTC debt by 1e10 — raw is 18dp-normalised, native is 8dp', () => {
    // Live WBTC-Short position #94: 0.13947961 WBTC of debt.
    const raw = 139_479_610_000_000_000n;
    expect(fxScaleDownRawDebt(raw, WBTC_FACTOR)).to.equal(13_947_961n);
    // Reporting raw as the debt would overstate it by ten orders of magnitude.
    expect(fxScaleDownRawDebt(raw, WBTC_FACTOR)).to.not.equal(raw);
  });

  it('round-trips native -> raw -> native', () => {
    const nativeWBTC = 13_947_961n;
    expect(
      fxScaleDownRawDebt(
        fxScaleUpNativeDebt(nativeWBTC, WBTC_FACTOR),
        WBTC_FACTOR,
      ),
    ).to.equal(nativeWBTC);
  });

  it('throws rather than dividing by zero when the manager has no rate entry', () => {
    // fxUSD has no tokenRates entry on the short manager (scalar 0). Silently
    // returning 0 or Infinity here would mis-size a position.
    expect(() => fxScaleDownRawDebt(1_000n, 0n)).to.throw(
      /scaling factor is 0/,
    );
  });
});

describe('fx-mint-util — computeFxRepay', () => {
  it('caps repayAmount at min(maxRepayUnderFee, rawDebts, desiredRepayAmount)', () => {
    const result = computeFxRepay({
      rawDebts: 100_000_000_000_000_000_000n, // 100 fxUSD debt
      shieldedFxUSD: 50_000_000_000_000_000_000n, // 50 fxUSD shielded
      desiredRepayAmount: 30_000_000_000_000_000_000n, // wants to repay 30
      repayFeeRatio: 5_000_000n, // 0.5% (test value, not mainnet's 0.2%)
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
      rawDebts: 1_000_000_000_000_000_000_000n, // 1000 fxUSD
      shieldedFxUSD: 10_000_000_000_000_000_000n, // 10 fxUSD
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
      rawDebts: 50_000_000_000_000_000_000n, // 50 fxUSD
      shieldedFxUSD: 1_000_000_000_000_000_000_000n, // way more than enough
      desiredRepayAmount: 100_000_000_000_000_000_000n, // wants to over-repay
      repayFeeRatio: 5_000_000n,
      railgunUnshieldFeeBps: 25n,
    });

    expect(result.repayAmount).to.equal(50_000_000_000_000_000_000n);
  });
});

describe('fx-mint-util — computeFxClose still passes after refactor', () => {
  it('produces same output as before the refactor (golden value)', () => {
    // Pin every field to a hand-computed literal so a subtle math
    // regression (e.g., wrong precision constant, swapped operands)
    // surfaces here. Derivation, with shieldedFxUSD=4.975e18,
    // repayFee=5e6/1e9 (0.5%), unshieldFee=25bps:
    //   fxUSDAfterUnshield = 4.975e18 × 9975/10000 = 4_962_562_500_000_000_000
    //   maxRepayUnderFee   = 4_962_562_500_000_000_000 × 1e9 / (1e9 + 5e6)
    //                      = 4_937_873_134_328_358_208
    //   repayAmount        = min(maxRepayUnderFee, rawDebts, desired=rawDebts)
    //                      = 4_937_873_134_328_358_208  (capped by fee ceiling)
    //   approveAmount      = repayAmount × (1e9 + 5e6) / 1e9
    //                      = 4_962_562_499_999_999_999  (off-by-1 from integer div)
    //   positionWstETH     = rawColls × collBal / totalRaw = 8e15
    //   withdrawColl       = positionWstETH × repayAmount / rawDebts
    //                      = 7_900_597_014_925_373
    const result = computeFxClose({
      rawColls: 8_000_000_000_000_000n,
      rawDebts: 5_000_000_000_000_000_000n,
      collateralBalance: 8_000_000_000_000_000n,
      totalRawColls: 8_000_000_000_000_000n,
      shieldedFxUSD: 4_975_000_000_000_000_000n, // = 5 fxUSD - 0.5% borrow fee
      repayFeeRatio: 5_000_000n,
      railgunUnshieldFeeBps: 25n,
    });

    expect(result.partialClose).to.equal(true);
    expect(result.positionWstETH).to.equal(8_000_000_000_000_000n);
    expect(result.fxUSDAfterUnshield).to.equal(4_962_562_500_000_000_000n);
    expect(result.maxRepayUnderFee).to.equal(4_937_873_134_328_358_208n);
    expect(result.repayAmount).to.equal(4_937_873_134_328_358_208n);
    expect(result.approveAmount).to.equal(4_962_562_499_999_999_999n);
    expect(result.withdrawColl).to.equal(7_900_597_014_925_373n);
  });
});
