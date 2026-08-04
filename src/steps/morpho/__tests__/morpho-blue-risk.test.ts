import chai from 'chai';
import {
  LIQUIDATION_CURSOR,
  MAX_LIQUIDATION_INCENTIVE_FACTOR,
  MorphoBlueMarketTotals,
  ORACLE_PRICE_SCALE,
  WAD,
  accrueMorphoBlueInterest,
  borrowAssetsForShares,
  computeMorphoBlueRisk,
  morphoBlueLiquidationIncentiveFactor,
  supplyAssetsForShares,
} from '../morpho-blue-util';

const { expect } = chai;

// ---------------------------------------------------------------------------
// Mainnet reference vector.
//
// Market `cbBTC / USDC 86%`, id
// 0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64, read at
// block 25,682,144 (timestamp 1785853631) against the Morpho Blue singleton
// 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb.
//
// Chosen because it is decimals-asymmetric in the awkward direction — 8-decimal
// collateral against a 6-decimal loan asset — which is exactly where an oracle
// scaled by `1e36 * 10^(loanDec - collDec)` goes wrong if the scale is assumed
// rather than applied.
//
// Cross-checked against Morpho's own indexer (blue-api.morpho.org), which
// reported healthFactor 1.6468707 and priceVariationToLiquidationPrice
// -0.3927878 for this account. The values below agree to seven significant
// figures; the residual is the indexer snapshotting a slightly different second.
// ---------------------------------------------------------------------------
const MAINNET = {
  lltv: 860000000000000000n,
  oraclePrice: 636047655174500000000000000000000000000n,
  storedTotals: {
    totalSupplyAssets: 304682388458346n,
    totalSupplyShares: 280267412671283355260n,
    totalBorrowAssets: 267326403368555n,
    totalBorrowShares: 243091805818788042389n,
    lastUpdate: 1785853583n,
    fee: 0n,
  } as MorphoBlueMarketTotals,
  timestamp: 1785853631n,
  borrowRatePerSecond: 1239693041n,
  accruedInterest: 15907329n,
  position: {
    collateral: 517471991335n,
    borrowShares: 156294603521351009671n,
    supplyShares: 0n,
  },
  expected: {
    borrowAssets: 171876121331103n,
    collateralValue: 329136846707105n,
    maxBorrowAssets: 283057688168110n,
    healthFactor: 1646870350435860059n,
    ltv: 522202612836154241n,
    liquidationPrice: 386215985372596997042454431105195344921n,
    borrowCapacityRemaining: 111181566837007n,
  },
};

describe('morpho-blue-util — interest accrual', () => {
  it('reproduces a mainnet accrual to the wei', () => {
    const accrual = accrueMorphoBlueInterest(
      MAINNET.storedTotals,
      MAINNET.borrowRatePerSecond,
      MAINNET.timestamp,
    );
    expect(accrual.elapsed).to.equal(48n);
    expect(accrual.interest).to.equal(MAINNET.accruedInterest);
    expect(accrual.totals.totalBorrowAssets).to.equal(
      MAINNET.storedTotals.totalBorrowAssets + MAINNET.accruedInterest,
    );
    // Interest lands on BOTH sides of the market.
    expect(accrual.totals.totalSupplyAssets).to.equal(
      MAINNET.storedTotals.totalSupplyAssets + MAINNET.accruedInterest,
    );
    // ...but mints no borrow shares, so a borrower's share count is untouched
    // while their debt grows.
    expect(accrual.totals.totalBorrowShares).to.equal(
      MAINNET.storedTotals.totalBorrowShares,
    );
    expect(accrual.feeShares).to.equal(0n);
    expect(accrual.totals.lastUpdate).to.equal(MAINNET.timestamp);
  });

  it('accrues nothing when no time has elapsed', () => {
    const accrual = accrueMorphoBlueInterest(
      MAINNET.storedTotals,
      MAINNET.borrowRatePerSecond,
      MAINNET.storedTotals.lastUpdate,
    );
    expect(accrual.elapsed).to.equal(0n);
    expect(accrual.interest).to.equal(0n);
    expect(accrual.totals.totalBorrowAssets).to.equal(
      MAINNET.storedTotals.totalBorrowAssets,
    );
  });

  it('accrues nothing when the market has no IRM (rate 0)', () => {
    // `irm == address(0)` is a real Blue configuration. The reader passes 0n
    // for it, and 0n must mean "this market accrues nothing" — a failed IRM
    // read never reaches here, it throws upstream.
    const accrual = accrueMorphoBlueInterest(
      MAINNET.storedTotals,
      0n,
      MAINNET.timestamp,
    );
    expect(accrual.interest).to.equal(0n);
    expect(accrual.elapsed).to.equal(48n);
    expect(accrual.totals.lastUpdate).to.equal(MAINNET.timestamp);
  });

  it('mints fee shares against the post-interest supply, net of the fee', () => {
    const fee = WAD / 10n; // 10%
    const totals: MorphoBlueMarketTotals = { ...MAINNET.storedTotals, fee };
    const accrual = accrueMorphoBlueInterest(
      totals,
      MAINNET.borrowRatePerSecond,
      MAINNET.timestamp,
    );
    const interest = accrual.interest;
    expect(interest).to.equal(MAINNET.accruedInterest);

    const feeAmount = (interest * fee) / WAD;
    const totalSupplyAssetsAfter = totals.totalSupplyAssets + interest;
    const expectedFeeShares =
      (feeAmount * (totals.totalSupplyShares + 10n ** 6n)) /
      (totalSupplyAssetsAfter - feeAmount + 1n);

    expect(accrual.feeShares).to.equal(expectedFeeShares);
    expect(accrual.totals.totalSupplyShares).to.equal(
      totals.totalSupplyShares + expectedFeeShares,
    );
    // The fee is a claim on existing supply, not new assets: supply assets grow
    // by exactly the interest, not the interest plus the fee.
    expect(accrual.totals.totalSupplyAssets).to.equal(totalSupplyAssetsAfter);
  });

  it('refuses to accrue backwards rather than silently clamping', () => {
    expect(() =>
      accrueMorphoBlueInterest(
        MAINNET.storedTotals,
        MAINNET.borrowRatePerSecond,
        MAINNET.storedTotals.lastUpdate - 1n,
      ),
    ).to.throw('cannot accrue backwards');
  });

  it('rejects a negative borrow rate', () => {
    expect(() =>
      accrueMorphoBlueInterest(MAINNET.storedTotals, -1n, MAINNET.timestamp),
    ).to.throw('borrow rate must be >= 0');
  });
});

describe('morpho-blue-util — share conversion rounding', () => {
  it('rounds debt up and a supply claim down', () => {
    // Same shares, same pool, opposite rounding: the borrower never owes less
    // than their share, the lender never claims more than theirs.
    const shares = 7n;
    const assets = 1000n;
    const totalShares = 3n;
    const up = borrowAssetsForShares(shares, assets, totalShares);
    const down = supplyAssetsForShares(shares, assets, totalShares);
    expect(up - down).to.equal(1n);
  });

  it('is virtual-share dominated on an empty market', () => {
    // Virtual shares (1e6) and virtual assets (1) are what stop an empty market
    // from being share-price manipulable. With no real liquidity a share is
    // worth ~1e-6 asset, not the whole pool.
    expect(borrowAssetsForShares(1n, 0n, 0n)).to.equal(1n);
    expect(supplyAssetsForShares(1n, 0n, 0n)).to.equal(0n);
    // It takes a full 1e6 shares to be owed a single asset unit.
    expect(borrowAssetsForShares(10n ** 6n, 0n, 0n)).to.equal(1n);
    expect(supplyAssetsForShares(10n ** 6n, 0n, 0n)).to.equal(1n);
  });
});

describe('morpho-blue-util — liquidation incentive factor', () => {
  it('matches the on-chain formula across the enabled LLTV ladder', () => {
    // Values computed from
    //   min(1.15e18, WAD / (WAD - 0.3e18 * (WAD - lltv) / WAD))
    // the expression in `Morpho.liquidate`.
    const cases: [bigint, bigint][] = [
      [770000000000000000n, 1074113856068743286n],
      [860000000000000000n, 1043841336116910229n],
      [915000000000000000n, 1026167265264238070n],
      [945000000000000000n, 1016776817488561260n],
      [980000000000000000n, 1006036217303822937n],
    ];
    for (const [lltv, expected] of cases) {
      expect(morphoBlueLiquidationIncentiveFactor(lltv)).to.equal(expected);
    }
  });

  it('caps at MAX_LIQUIDATION_INCENTIVE_FACTOR for low LLTVs', () => {
    // Uncapped, lltv=0 would give WAD/0.7e18 ≈ 1.4286e18.
    expect(morphoBlueLiquidationIncentiveFactor(0n)).to.equal(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
    expect(morphoBlueLiquidationIncentiveFactor(WAD / 2n)).to.equal(
      MAX_LIQUIDATION_INCENTIVE_FACTOR,
    );
  });

  it('is exactly WAD (no bonus) at lltv == WAD and rejects lltv > WAD', () => {
    expect(morphoBlueLiquidationIncentiveFactor(WAD)).to.equal(WAD);
    expect(() => morphoBlueLiquidationIncentiveFactor(WAD + 1n)).to.throw(
      'lltv must be within',
    );
    expect(() => morphoBlueLiquidationIncentiveFactor(-1n)).to.throw(
      'lltv must be within',
    );
  });

  it('pins the protocol constants', () => {
    expect(MAX_LIQUIDATION_INCENTIVE_FACTOR).to.equal(1150000000000000000n);
    expect(LIQUIDATION_CURSOR).to.equal(300000000000000000n);
  });
});

describe('morpho-blue-util — computeMorphoBlueRisk', () => {
  it('reproduces a live mainnet position', () => {
    const accrual = accrueMorphoBlueInterest(
      MAINNET.storedTotals,
      MAINNET.borrowRatePerSecond,
      MAINNET.timestamp,
    );
    const borrowAssets = borrowAssetsForShares(
      MAINNET.position.borrowShares,
      accrual.totals.totalBorrowAssets,
      accrual.totals.totalBorrowShares,
    );
    expect(borrowAssets).to.equal(MAINNET.expected.borrowAssets);

    const risk = computeMorphoBlueRisk({
      collateral: MAINNET.position.collateral,
      borrowAssets,
      oraclePrice: MAINNET.oraclePrice,
      lltv: MAINNET.lltv,
    });

    expect(risk.collateralValue).to.equal(MAINNET.expected.collateralValue);
    expect(risk.maxBorrowAssets).to.equal(MAINNET.expected.maxBorrowAssets);
    expect(risk.healthFactor).to.equal(MAINNET.expected.healthFactor);
    expect(risk.ltv).to.equal(MAINNET.expected.ltv);
    expect(risk.liquidationPrice).to.equal(MAINNET.expected.liquidationPrice);
    expect(risk.borrowCapacityRemaining).to.equal(
      MAINNET.expected.borrowCapacityRemaining,
    );
    expect(risk.isLiquidatable).to.equal(false);
  });

  it('applies the oracle scale, not an assumed one', () => {
    // 1 cbBTC (8dp) at the mainnet price must value at ~63,604.77 USDC (6dp).
    // Getting `ORACLE_PRICE_SCALE * 10^(loanDec - collDec)` wrong moves this by
    // orders of magnitude, silently.
    const oneCbBtc = 10n ** 8n;
    const risk = computeMorphoBlueRisk({
      collateral: oneCbBtc,
      borrowAssets: 0n,
      oraclePrice: MAINNET.oraclePrice,
      lltv: MAINNET.lltv,
    });
    expect(risk.collateralValue).to.equal(63604765517n); // 63,604.765517 USDC
  });

  describe('edge cases', () => {
    const price = ORACLE_PRICE_SCALE; // 1 loan unit per collateral unit
    const lltv = 800000000000000000n; // 80%

    it('zero debt: health factor is undefined, not zero', () => {
      const risk = computeMorphoBlueRisk({
        collateral: 1000n,
        borrowAssets: 0n,
        oraclePrice: price,
        lltv,
      });
      // The trap this guards: `healthFactor: 0n` on a debt-free position reads
      // as "about to be liquidated" on any panel that compares against 1e18.
      expect(risk.healthFactor).to.equal(undefined);
      expect(risk.liquidationPrice).to.equal(undefined);
      expect(risk.ltv).to.equal(0n); // defined, and genuinely zero
      expect(risk.isLiquidatable).to.equal(false);
      expect(risk.collateralValue).to.equal(1000n);
      expect(risk.maxBorrowAssets).to.equal(800n);
      expect(risk.borrowCapacityRemaining).to.equal(800n);
    });

    it('zero collateral with debt: liquidatable, LTV undefined', () => {
      const risk = computeMorphoBlueRisk({
        collateral: 0n,
        borrowAssets: 100n,
        oraclePrice: price,
        lltv,
      });
      expect(risk.collateralValue).to.equal(0n);
      expect(risk.maxBorrowAssets).to.equal(0n);
      // 0n here would read as "0% LTV, perfectly safe" — the inverse of the truth.
      expect(risk.ltv).to.equal(undefined);
      // Health factor IS legitimately 0 here: no collateral backs real debt.
      expect(risk.healthFactor).to.equal(0n);
      expect(risk.isLiquidatable).to.equal(true);
      // No price makes this position healthy again, so there is no threshold.
      expect(risk.liquidationPrice).to.equal(undefined);
      expect(risk.borrowCapacityRemaining).to.equal(0n);
    });

    it('empty position: nothing is liquidatable and nothing is invented', () => {
      const risk = computeMorphoBlueRisk({
        collateral: 0n,
        borrowAssets: 0n,
        oraclePrice: price,
        lltv,
      });
      expect(risk.ltv).to.equal(undefined);
      expect(risk.healthFactor).to.equal(undefined);
      expect(risk.liquidationPrice).to.equal(undefined);
      expect(risk.isLiquidatable).to.equal(false);
      expect(risk.borrowCapacityRemaining).to.equal(0n);
    });

    it('exactly at LLTV: healthy, health factor exactly 1e18', () => {
      const collateral = 1000n;
      // maxBorrow = 1000 * 0.8 = 800.
      const risk = computeMorphoBlueRisk({
        collateral,
        borrowAssets: 800n,
        oraclePrice: price,
        lltv,
      });
      expect(risk.maxBorrowAssets).to.equal(800n);
      expect(risk.healthFactor).to.equal(WAD);
      expect(risk.ltv).to.equal(lltv);
      // Morpho's check is `maxBorrow >= borrowed`, so the boundary is healthy.
      expect(risk.isLiquidatable).to.equal(false);
      expect(risk.borrowCapacityRemaining).to.equal(0n);
    });

    it('one wei past LLTV: liquidatable', () => {
      const risk = computeMorphoBlueRisk({
        collateral: 1000n,
        borrowAssets: 801n,
        oraclePrice: price,
        lltv,
      });
      expect(risk.isLiquidatable).to.equal(true);
      expect(risk.healthFactor !== undefined && risk.healthFactor < WAD).to.equal(
        true,
      );
      expect(risk.borrowCapacityRemaining).to.equal(0n);
    });

    it('liquidationPrice is the exact boundary it claims to be', () => {
      // The condition being inverted has TWO floors. Collapsing it into a
      // single rounded-up division only undoes the outer one, and produces a
      // price at which the position is ALREADY liquidatable — off by 2x on the
      // dust case below. Each shape here is checked in both directions.
      const shapes: { collateral: bigint; borrowAssets: bigint; lltv: bigint }[] =
        [
          // A realistic 3-cbBTC position against USDC.
          { collateral: 3_00000000n, borrowAssets: 45_000_000000n, lltv: MAINNET.lltv },
          // The live mainnet position.
          {
            collateral: MAINNET.position.collateral,
            borrowAssets: MAINNET.expected.borrowAssets,
            lltv: MAINNET.lltv,
          },
          // Dust debt against whole-unit collateral — where the naive form is
          // worst.
          { collateral: 10n ** 8n, borrowAssets: 1n, lltv: 945000000000000000n },
          // Awkward, non-round magnitudes.
          {
            collateral: 12345678901n,
            borrowAssets: 987654321n,
            lltv: 915000000000000000n,
          },
        ];

      for (const shape of shapes) {
        const base = { ...shape, oraclePrice: MAINNET.oraclePrice };
        const liquidationPrice = computeMorphoBlueRisk(base).liquidationPrice;
        expect(liquidationPrice, JSON.stringify(shape, (_k, v) => String(v))).to
          .not.equal(undefined);
        if (liquidationPrice === undefined) {
          continue;
        }

        // Healthy AT the reported price...
        expect(
          computeMorphoBlueRisk({ ...base, oraclePrice: liquidationPrice })
            .isLiquidatable,
          `healthy at liquidationPrice for ${String(shape.collateral)}`,
        ).to.equal(false);
        // ...liquidatable one price-unit below it. Both directions together are
        // what make it the boundary rather than an approximation of one.
        expect(
          computeMorphoBlueRisk({ ...base, oraclePrice: liquidationPrice - 1n })
            .isLiquidatable,
          `liquidatable one unit below liquidationPrice for ${String(shape.collateral)}`,
        ).to.equal(true);
      }
    });

    it('lltv == 0 has no finite liquidation price', () => {
      const risk = computeMorphoBlueRisk({
        collateral: 1000n,
        borrowAssets: 1n,
        oraclePrice: price,
        lltv: 0n,
      });
      expect(risk.maxBorrowAssets).to.equal(0n);
      expect(risk.isLiquidatable).to.equal(true);
      expect(risk.liquidationPrice).to.equal(undefined);
    });

    it('rejects negative inputs', () => {
      expect(() =>
        computeMorphoBlueRisk({
          collateral: -1n,
          borrowAssets: 0n,
          oraclePrice: price,
          lltv,
        }),
      ).to.throw('must be >= 0');
    });
  });
});
