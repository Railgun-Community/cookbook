import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Interface,
  InterfaceAbi,
  JsonRpcProvider,
  Provider,
  TransactionRequest,
} from 'ethers';
import { abi } from '../../../abi/abi';
import {
  MorphoBlueAPI,
  MorphoBlueMarket,
  MorphoBluePositionRisk,
} from '../morpho-blue-api';
import { MorphoBluePosition } from '../../../contract/morpho/morpho-blue-contract';
import {
  MORPHO_BLUE_ADDRESS,
  MorphoBlueMarketTotals,
  ORACLE_PRICE_SCALE,
  WAD,
  getMarketId,
} from '../../../steps/morpho/morpho-blue-util';
import { makeEphemeralExecutor } from '../../../utils/7702';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// Mainnet fixture: market `cbBTC / USDC 86%`, id
// 0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64, read from
// the Blue singleton at block 25,682,144 (timestamp 1785853631).
//
// Every number below came off chain; the stub provider below replays them, so
// the reader is exercised end to end — market resolution, oracle scale, IRM
// accrual, share conversion, risk math — with no network and no invented
// values. Cross-checked against Morpho's own indexer: healthFactor 1.6468707,
// priceVariationToLiquidationPrice -0.3927878 for the borrower below.
// ---------------------------------------------------------------------------
const MARKET_ID =
  '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const ORACLE = '0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a';
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC';
const LLTV = 860000000000000000n;
const ORACLE_PRICE = 636047655174500000000000000000000000000n;
const BORROW_RATE_PER_SECOND = 1239693041n;
const BLOCK_TIMESTAMP = 1785853631n;

const STORED_TOTALS: MorphoBlueMarketTotals = {
  totalSupplyAssets: 304682388458346n,
  totalSupplyShares: 280267412671283355260n,
  totalBorrowAssets: 267326403368555n,
  totalBorrowShares: 243091805818788042389n,
  lastUpdate: 1785853583n,
  fee: 0n,
};

const BORROWER = '0xbCd16D361adf5E7e0dc0010756B49666b4f38eE0';
const BORROWER_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 156294603521351009671n,
  collateral: 517471991335n,
};

const EMPTY_ACCOUNT = '0x1111111111111111111111111111111111111111';
const UNREADABLE_ACCOUNT = '0x2222222222222222222222222222222222222222';

// ---------------------------------------------------------------------------
// Stub provider — replays the fixture, and fails on demand.
// ---------------------------------------------------------------------------
const blueIface = new Interface(abi.morpho.blue as InterfaceAbi);
const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);
const oracleIface = new Interface(['function price() view returns (uint256)']);
const irmIface = new Interface([
  'function borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128)) view returns (uint256)',
]);

type StubOptions = {
  /** Selector labels that should reject instead of returning data. */
  fail?: ReadonlySet<string>;
  /** Accounts whose `position()` read should reject. */
  failPositionFor?: ReadonlySet<string>;
  /** Return an all-zero market descriptor, as a never-created id does. */
  zeroMarketParams?: boolean;
  /** Return `lastUpdate == 0`, as a never-created market does. */
  zeroMarketState?: boolean;
  /** Override the market descriptor's oracle (e.g. address(0) for an idle market). */
  oracle?: string;
  /** Override the timestamp `getBlock('latest')` reports. */
  blockTimestamp?: bigint;
  /** Override the oracle's reported price (0n for a dead feed). */
  oraclePrice?: bigint;
  /** Override the market's protocol fee. */
  fee?: bigint;
  /** Records the peak number of simultaneous in-flight `position()` calls. */
  concurrencyProbe?: { inFlight: number; max: number };
};

const ZERO = '0x0000000000000000000000000000000000000000';

const makeStubProvider = (options: StubOptions = {}): Provider => {
  const fails = (label: string): boolean => options.fail?.has(label) === true;

  const call = async (tx: TransactionRequest): Promise<string> => {
    const to = (tx.to as string).toLowerCase();
    const data = tx.data as string;
    const selector = data.slice(0, 10);

    if (to === MORPHO_BLUE_ADDRESS.toLowerCase()) {
      if (selector === blueIface.getFunction('idToMarketParams')?.selector) {
        if (fails('idToMarketParams')) {
          throw new Error('stub: idToMarketParams reverted');
        }
        return blueIface.encodeFunctionResult('idToMarketParams', [
          options.zeroMarketParams === true
            ? [ZERO, ZERO, ZERO, ZERO, 0n]
            : [USDC, CBBTC, options.oracle ?? ORACLE, IRM, LLTV],
        ]);
      }
      if (selector === blueIface.getFunction('market')?.selector) {
        if (fails('market')) {
          throw new Error('stub: market reverted');
        }
        return blueIface.encodeFunctionResult('market', [
          STORED_TOTALS.totalSupplyAssets,
          STORED_TOTALS.totalSupplyShares,
          STORED_TOTALS.totalBorrowAssets,
          STORED_TOTALS.totalBorrowShares,
          options.zeroMarketState === true ? 0n : STORED_TOTALS.lastUpdate,
          options.fee ?? STORED_TOTALS.fee,
        ]);
      }
      if (selector === blueIface.getFunction('position')?.selector) {
        const decoded = blueIface.decodeFunctionData('position', data);
        const account = decoded[1] as string;
        const probe = options.concurrencyProbe;
        if (probe !== undefined) {
          probe.inFlight += 1;
          probe.max = Math.max(probe.max, probe.inFlight);
          // Yield, so genuinely-parallel calls overlap and are observed as such.
          await new Promise(resolve => setTimeout(resolve, 1));
          probe.inFlight -= 1;
        }
        if (options.failPositionFor?.has(account.toLowerCase()) === true) {
          throw new Error(`stub: position(${account}) reverted`);
        }
        const position =
          account.toLowerCase() === BORROWER.toLowerCase()
            ? BORROWER_POSITION
            : { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
        return blueIface.encodeFunctionResult('position', [
          position.supplyShares,
          position.borrowShares,
          position.collateral,
        ]);
      }
    }

    if (to === ORACLE.toLowerCase()) {
      if (fails('price')) {
        throw new Error('stub: oracle price reverted');
      }
      return oracleIface.encodeFunctionResult('price', [
        options.oraclePrice ?? ORACLE_PRICE,
      ]);
    }

    if (to === IRM.toLowerCase()) {
      if (fails('borrowRateView')) {
        throw new Error('stub: borrowRateView reverted');
      }
      return irmIface.encodeFunctionResult('borrowRateView', [
        BORROW_RATE_PER_SECOND,
      ]);
    }

    if (to === USDC.toLowerCase() || to === CBBTC.toLowerCase()) {
      if (fails('decimals')) {
        throw new Error('stub: decimals reverted');
      }
      return erc20Iface.encodeFunctionResult('decimals', [
        to === USDC.toLowerCase() ? 6n : 8n,
      ]);
    }

    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };

  return {
    call,
    getBlock: async () => {
      if (fails('getBlock')) {
        throw new Error('stub: getBlock failed');
      }
      return { timestamp: Number(options.blockTimestamp ?? BLOCK_TIMESTAMP) };
    },
  } as unknown as Provider;
};

describe('MorphoBlueAPI risk reader — market read', () => {
  it('reads a market by id and accrues it to the block timestamp', async () => {
    const market = await MorphoBlueAPI.getMarket({
      market: MARKET_ID,
      provider: makeStubProvider(),
    });

    expect(market.marketId).to.equal(MARKET_ID);
    expect(market.loanToken).to.equal(USDC);
    expect(market.collateralToken).to.equal(CBBTC);
    expect(market.loanDecimals).to.equal(6n);
    expect(market.collateralDecimals).to.equal(8n);
    expect(market.lltv).to.equal(LLTV);
    expect(market.oraclePrice).to.equal(ORACLE_PRICE);
    expect(market.borrowRatePerSecond).to.equal(BORROW_RATE_PER_SECOND);

    // 48 s of accrual at 1243105467 wei/s compounded.
    expect(market.elapsed).to.equal(48n);
    expect(market.accruedInterest).to.equal(15907329n);
    expect(market.storedTotals.totalBorrowAssets).to.equal(
      STORED_TOTALS.totalBorrowAssets,
    );
    expect(market.totals.totalBorrowAssets).to.equal(
      STORED_TOTALS.totalBorrowAssets + market.accruedInterest,
    );

    // Liquidity is accrual-invariant: interest lands on supply and borrow
    // equally, so the difference is untouched. (Verified against Morpho's own
    // indexer, which reports the same figure from a different snapshot.)
    expect(market.liquidityAssets).to.equal(
      STORED_TOTALS.totalSupplyAssets - STORED_TOTALS.totalBorrowAssets,
    );
    expect(market.liquidationIncentiveFactor).to.equal(1043841336116910229n);
  });

  it('derives the id locally when handed market params (no extra read)', async () => {
    const params = {
      loanToken: USDC,
      collateralToken: CBBTC,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    };
    expect(getMarketId(params)).to.equal(MARKET_ID);

    // `idToMarketParams` is configured to reject; the read must not happen.
    const market = await MorphoBlueAPI.getMarket({
      market: params,
      provider: makeStubProvider({ fail: new Set(['idToMarketParams']) }),
    });
    expect(market.marketId).to.equal(MARKET_ID);
  });

  it('dilutes a lender when the market charges a protocol fee', async () => {
    // Exercises accrual's fee branch through the reader, not just through the
    // pure helper: fee shares are minted to the fee recipient, so the same
    // supply shares are worth strictly less than in a fee-free market.
    const lender: MorphoBluePosition = {
      supplyShares: 1000000000000000000n,
      borrowShares: 0n,
      collateral: 0n,
    };

    const feeFree = await MorphoBlueAPI.getMarket({
      market: MARKET_ID,
      provider: makeStubProvider(),
    });
    const withFee = await MorphoBlueAPI.getMarket({
      market: MARKET_ID,
      provider: makeStubProvider({ fee: WAD / 10n }), // 10%
    });

    // Interest is identical — the fee is a claim on it, not extra assets.
    expect(withFee.accruedInterest).to.equal(feeFree.accruedInterest);
    expect(withFee.totals.totalSupplyAssets).to.equal(
      feeFree.totals.totalSupplyAssets,
    );
    // ...taken by minting new supply shares.
    expect(
      withFee.totals.totalSupplyShares > feeFree.totals.totalSupplyShares,
    ).to.equal(true);

    const paidFee = MorphoBlueAPI.buildPositionRisk({
      market: withFee,
      owner: BORROWER,
      position: lender,
    });
    const noFee = MorphoBlueAPI.buildPositionRisk({
      market: feeFree,
      owner: BORROWER,
      position: lender,
    });
    expect(paidFee.supplyAssets < noFee.supplyAssets).to.equal(true);
  });

  it('honours an explicit timestamp instead of reading the block', async () => {
    const market = await MorphoBlueAPI.getMarket({
      market: MARKET_ID,
      provider: makeStubProvider({ fail: new Set(['getBlock']) }),
      timestamp: STORED_TOTALS.lastUpdate,
    });
    expect(market.elapsed).to.equal(0n);
    expect(market.accruedInterest).to.equal(0n);
    expect(market.totals.totalBorrowAssets).to.equal(
      STORED_TOTALS.totalBorrowAssets,
    );
  });
});

describe('MorphoBlueAPI risk reader — never maps a read error to zero', () => {
  // Brief §9. Each case below is one where an implementation that swallowed the
  // error would produce a plausible-looking, wrong answer.

  it('rejects an all-zero market descriptor instead of reading it as empty', async () => {
    // `idToMarketParams` on a never-created id returns five zero words rather
    // than reverting.
    await expect(
      MorphoBlueAPI.getMarket({
        market: MARKET_ID,
        provider: makeStubProvider({ zeroMarketParams: true }),
      }),
    ).to.eventually.be.rejectedWith('all-zero descriptor');
  });

  it('rejects a market with lastUpdate 0 instead of reading it as empty', async () => {
    await expect(
      MorphoBlueAPI.getMarket({
        market: MARKET_ID,
        provider: makeStubProvider({ zeroMarketState: true }),
      }),
    ).to.eventually.be.rejectedWith('never been created');
  });

  it('refuses a market with no oracle rather than valuing collateral at zero', async () => {
    await expect(
      MorphoBlueAPI.getMarket({
        market: MARKET_ID,
        provider: makeStubProvider({ oracle: ZERO }),
      }),
    ).to.eventually.be.rejectedWith('has no oracle');
  });

  it('refuses an oracle that returns price 0 — the read succeeds, the answer is a lie', async () => {
    // A dead feed is the `oracle == address(0)` case one hop out: nothing
    // throws, but every account in the market comes back
    // `healthFactor: 0n, isLiquidatable: true`.
    await expect(
      MorphoBlueAPI.getMarket({
        market: MARKET_ID,
        provider: makeStubProvider({ oraclePrice: 0n }),
      }),
    ).to.eventually.be.rejectedWith('returned price 0');
  });

  it('throws naming the read that failed, for every read in the path', async () => {
    const cases: [string, string][] = [
      ['idToMarketParams', 'idToMarketParams'],
      ['market', 'market('],
      ['price', 'IOracle.price()'],
      ['decimals', 'decimals()'],
      ['borrowRateView', 'IIrm.borrowRateView()'],
      ['getBlock', 'getBlock("latest")'],
    ];
    for (const [label, expected] of cases) {
      await expect(
        MorphoBlueAPI.getMarket({
          market: MARKET_ID,
          provider: makeStubProvider({ fail: new Set([label]) }),
        }),
        `expected the ${label} failure to surface`,
      ).to.eventually.be.rejectedWith(expected);
    }
  });

  it('propagates a failed position read rather than returning a closed position', async () => {
    await expect(
      MorphoBlueAPI.getPositionRisk({
        market: MARKET_ID,
        owner: BORROWER,
        provider: makeStubProvider({
          failPositionFor: new Set([BORROWER.toLowerCase()]),
        }),
      }),
    ).to.eventually.be.rejectedWith('position(');
  });

  it('counts unreadable owners instead of reporting them as empty', async () => {
    const report = await MorphoBlueAPI.getPositionRisks({
      market: MARKET_ID,
      owners: [BORROWER, EMPTY_ACCOUNT, UNREADABLE_ACCOUNT, 'not-an-address'],
      provider: makeStubProvider({
        failPositionFor: new Set([UNREADABLE_ACCOUNT.toLowerCase()]),
      }),
    });

    expect(report.positions.length).to.equal(2);
    expect(report.unreadableCount).to.equal(2);
    expect(report.unreadable.map(u => u.owner)).to.deep.equal([
      UNREADABLE_ACCOUNT,
      'not-an-address',
    ]);
    // The distinction the count exists to preserve: one account genuinely holds
    // nothing, two could not be read. Without `unreadableCount` all three look
    // the same.
    const empty = report.positions.find(p => p.owner === EMPTY_ACCOUNT);
    expect(empty?.isEmpty).to.equal(true);
    expect(report.positions.find(p => p.owner === BORROWER)?.isEmpty).to.equal(
      false,
    );
    // A malformed address is that owner's failure, not the whole scan's.
    expect(report.market.marketId).to.equal(MARKET_ID);
  });

  it('bounds concurrency and preserves input order across chunks', async () => {
    const owners = [
      EMPTY_ACCOUNT,
      BORROWER,
      UNREADABLE_ACCOUNT,
      EMPTY_ACCOUNT,
      BORROWER,
      EMPTY_ACCOUNT,
      BORROWER,
    ];
    // Order alone is NOT enough to pin this: `Promise.all` over the whole list
    // preserves order identically, so an unbounded implementation would pass an
    // order-only assertion. The probe observes actual overlap, so deleting the
    // chunking loop fails this test.
    const concurrencyProbe = { inFlight: 0, max: 0 };
    const report = await MorphoBlueAPI.getPositionRisks({
      market: MARKET_ID,
      owners,
      provider: makeStubProvider({
        failPositionFor: new Set([UNREADABLE_ACCOUNT.toLowerCase()]),
        concurrencyProbe,
      }),
      concurrency: 2,
    });
    expect(concurrencyProbe.max).to.be.at.most(2);
    // ...and it really did run in parallel within a chunk, so the bound is a
    // bound rather than an accidental serialisation.
    expect(concurrencyProbe.max).to.equal(2);
    expect(report.positions.map(p => p.owner)).to.deep.equal([
      EMPTY_ACCOUNT,
      BORROWER,
      EMPTY_ACCOUNT,
      BORROWER,
      EMPTY_ACCOUNT,
      BORROWER,
    ]);
    expect(report.unreadableCount).to.equal(1);
  });

  it('rejects a nonsensical concurrency instead of silently defaulting', async () => {
    for (const concurrency of [0, -1, 1.5]) {
      await expect(
        MorphoBlueAPI.getPositionRisks({
          market: MARKET_ID,
          owners: [BORROWER],
          provider: makeStubProvider(),
          concurrency,
        }),
      ).to.eventually.be.rejectedWith('concurrency must be a positive integer');
    }
  });

  it('refuses to accrue zero interest when the block read lags the state read', async () => {
    // Two round trips against a load-balanced RPC pool can be served by nodes
    // at different heights. Clamping to zero accrual there would report a debt
    // smaller than the one a liquidator sees.
    await expect(
      MorphoBlueAPI.getMarket({
        market: MARKET_ID,
        provider: makeStubProvider({
          blockTimestamp: STORED_TOTALS.lastUpdate - 1n,
        }),
      }),
    ).to.eventually.be.rejectedWith('nodes at different heights');
  });

  it('fails the whole scan when the shared market read fails', async () => {
    // A partial answer here would be a fiction: with no market state, no
    // position is computable.
    await expect(
      MorphoBlueAPI.getPositionRisks({
        market: MARKET_ID,
        owners: [BORROWER],
        provider: makeStubProvider({ fail: new Set(['market']) }),
      }),
    ).to.eventually.be.rejectedWith('read failed');
  });
});

describe('MorphoBlueAPI risk reader — position risk', () => {
  it('reproduces a live mainnet position end to end', async () => {
    const risk = await MorphoBlueAPI.getPositionRisk({
      market: MARKET_ID,
      owner: BORROWER,
      provider: makeStubProvider(),
    });

    expect(risk.owner).to.equal(BORROWER);
    expect(risk.marketId).to.equal(MARKET_ID);
    expect(risk.collateral).to.equal(BORROWER_POSITION.collateral);
    expect(risk.borrowShares).to.equal(BORROWER_POSITION.borrowShares);
    expect(risk.borrowAssets).to.equal(171876121331103n);
    expect(risk.collateralValue).to.equal(329136846707105n);
    expect(risk.maxBorrowAssets).to.equal(283057688168110n);
    expect(risk.ltv).to.equal(522202612836154241n);
    expect(risk.healthFactor).to.equal(1646870350435860059n);
    expect(risk.liquidationPrice).to.equal(
      386215985372596997042454431105195344921n,
    );
    expect(risk.borrowCapacityRemaining).to.equal(111181566837007n);
    expect(risk.isLiquidatable).to.equal(false);
    expect(risk.isEmpty).to.equal(false);
    expect(risk.timestamp).to.equal(BLOCK_TIMESTAMP);

    // Health factor and LTV are two views of one number: ltv/lltv == 1/hf.
    const hf = risk.healthFactor;
    const ltv = risk.ltv;
    expect(hf === undefined || ltv === undefined).to.equal(false);
    if (hf !== undefined && ltv !== undefined) {
      const impliedLtv = (LLTV * WAD) / hf;
      const drift = impliedLtv > ltv ? impliedLtv - ltv : ltv - impliedLtv;
      // Both are integer-rounded independently; agreement to <1e-12 confirms
      // they are not independently wrong.
      expect(drift < 1000n).to.equal(true);
    }
  });

  it('caps borrowableAssets at market liquidity, keeping the collateral bound separate', async () => {
    const risk = await MorphoBlueAPI.getPositionRisk({
      market: MARKET_ID,
      owner: BORROWER,
      provider: makeStubProvider(),
    });
    // The borrower's collateral permits ~111.2M USDC more debt but the market
    // only holds ~37.4M. Reporting only the collateral bound would promise a
    // borrow that reverts with InsufficientLiquidity.
    expect(risk.borrowCapacityRemaining > risk.borrowableAssets).to.equal(true);
    expect(risk.borrowableAssets).to.equal(
      STORED_TOTALS.totalSupplyAssets - STORED_TOTALS.totalBorrowAssets,
    );
  });

  it('reports an account with no position as empty, with no invented ratios', async () => {
    const risk = await MorphoBlueAPI.getPositionRisk({
      market: MARKET_ID,
      owner: EMPTY_ACCOUNT,
      provider: makeStubProvider(),
    });
    expect(risk.isEmpty).to.equal(true);
    expect(risk.borrowAssets).to.equal(0n);
    expect(risk.supplyAssets).to.equal(0n);
    expect(risk.healthFactor).to.equal(undefined);
    expect(risk.ltv).to.equal(undefined);
    expect(risk.liquidationPrice).to.equal(undefined);
    expect(risk.isLiquidatable).to.equal(false);
  });
});

describe('MorphoBlueAPI.buildPositionRisk — pure combination', () => {
  const market: MorphoBlueMarket = {
    marketId: MARKET_ID,
    params: {
      loanToken: USDC,
      collateralToken: CBBTC,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    },
    loanToken: USDC,
    loanDecimals: 6n,
    collateralToken: CBBTC,
    collateralDecimals: 8n,
    lltv: LLTV,
    liquidationIncentiveFactor: 1043841336116910229n,
    oracle: ORACLE,
    oraclePrice: ORACLE_PRICE,
    irm: IRM,
    borrowRatePerSecond: BORROW_RATE_PER_SECOND,
    totals: STORED_TOTALS,
    storedTotals: STORED_TOTALS,
    accruedInterest: 0n,
    elapsed: 0n,
    timestamp: STORED_TOTALS.lastUpdate,
    liquidityAssets:
      STORED_TOTALS.totalSupplyAssets - STORED_TOTALS.totalBorrowAssets,
    utilization:
      (STORED_TOTALS.totalBorrowAssets * WAD) / STORED_TOTALS.totalSupplyAssets,
  };

  const build = (
    position: MorphoBluePosition,
    owner: string = BORROWER,
  ): MorphoBluePositionRisk =>
    MorphoBlueAPI.buildPositionRisk({ market, owner, position });

  it('accepts an EphemeralExecutor and a raw address alike', () => {
    const executor = makeEphemeralExecutor(BORROWER);
    const viaExecutor = MorphoBlueAPI.buildPositionRisk({
      market,
      owner: executor,
      position: BORROWER_POSITION,
    });
    expect(viaExecutor.owner).to.equal(build(BORROWER_POSITION).owner);
  });

  it('accepts the shared relay-adapt as a read target', () => {
    // Deliberate divergence from `resolveExecutorAddress`, which rejects it.
    // That guard protects fund routing; a scanner must still be able to look at
    // a position stranded on the relay-adapt, and refusing to read one would
    // hide exactly the failure worth finding.
    const RELAY_ADAPT_ETHEREUM = '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a';
    const risk = build(BORROWER_POSITION, RELAY_ADAPT_ETHEREUM);
    expect(risk.owner.toLowerCase()).to.equal(
      RELAY_ADAPT_ETHEREUM.toLowerCase(),
    );
  });

  it('rejects a malformed or zero owner', () => {
    expect(() => build(BORROWER_POSITION, 'nope')).to.throw(
      'invalid recipient address',
    );
    expect(() => build(BORROWER_POSITION, ZERO)).to.throw(
      'invalid recipient address',
    );
  });

  it('carries the lend side so a pure lender is not reported as empty', () => {
    const risk = build({
      supplyShares: 1000000000000000000n,
      borrowShares: 0n,
      collateral: 0n,
    });
    expect(risk.isEmpty).to.equal(false);
    expect(risk.supplyAssets > 0n).to.equal(true);
    expect(risk.healthFactor).to.equal(undefined);
    expect(risk.isLiquidatable).to.equal(false);
  });

  it('flags a position past the LLTV as liquidatable', () => {
    // Same debt, collateral cut so that maxBorrow falls under it.
    const risk = build({
      supplyShares: 0n,
      borrowShares: BORROWER_POSITION.borrowShares,
      collateral: BORROWER_POSITION.collateral / 4n,
    });
    expect(risk.isLiquidatable).to.equal(true);
    const hf = risk.healthFactor;
    expect(hf !== undefined && hf < WAD).to.equal(true);
    expect(risk.borrowCapacityRemaining).to.equal(0n);
    expect(risk.borrowableAssets).to.equal(0n);
    // The liquidation price is now ABOVE the current oracle price — that is
    // what "already liquidatable" looks like on the price axis.
    const liquidationPrice = risk.liquidationPrice;
    expect(liquidationPrice !== undefined && liquidationPrice > ORACLE_PRICE).to.equal(
      true,
    );
  });

  it('keeps the oracle scale, not a decimals-derived guess', () => {
    // A market whose oracle price is exactly ORACLE_PRICE_SCALE means 1 unit of
    // collateral == 1 unit of loan, whatever the two tokens' decimals are.
    const unitPriceMarket: MorphoBlueMarket = {
      ...market,
      oraclePrice: ORACLE_PRICE_SCALE,
    };
    const risk = MorphoBlueAPI.buildPositionRisk({
      market: unitPriceMarket,
      owner: BORROWER,
      position: { supplyShares: 0n, borrowShares: 0n, collateral: 12345n },
    });
    expect(risk.collateralValue).to.equal(12345n);
  });
});

// ---------------------------------------------------------------------------
// Live mainnet read. Mirrors the gate the f(x) reader test uses.
// ---------------------------------------------------------------------------
describe('MorphoBlueAPI risk reader — mainnet [requires RUN_FORK_TESTS=1]', function () {
  this.timeout(60_000);

  if (process.env.RUN_FORK_TESTS === undefined) {
    it.skip('skipped — set RUN_FORK_TESTS=1 to run', () => {});
    return;
  }

  const rpcUrl =
    process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
  const provider = new JsonRpcProvider(rpcUrl);

  it('reads the cbBTC/USDC 86% market live', async () => {
    const market = await MorphoBlueAPI.getMarket({
      market: MARKET_ID,
      provider,
    });
    expect(market.loanToken.toLowerCase()).to.equal(USDC.toLowerCase());
    expect(market.collateralToken.toLowerCase()).to.equal(CBBTC.toLowerCase());
    expect(market.loanDecimals).to.equal(6n);
    expect(market.collateralDecimals).to.equal(8n);
    expect(market.lltv).to.equal(LLTV);
    expect(market.liquidationIncentiveFactor).to.equal(1043841336116910229n);
    expect(market.oraclePrice > 0n).to.equal(true);
    expect(market.borrowRatePerSecond > 0n).to.equal(true);
    expect(market.totals.totalBorrowAssets >= market.storedTotals.totalBorrowAssets).to.equal(
      true,
    );
  });

  it('reads a live borrower and returns internally consistent risk', async () => {
    const risk = await MorphoBlueAPI.getPositionRisk({
      market: MARKET_ID,
      owner: BORROWER,
      provider,
    });
    // Shape and internal consistency only. This is a stranger's live position:
    // asserting it stays solvent (`hf > WAD`) would fail the day they repay or
    // get liquidated, for reasons unrelated to this code. The boundary
    // relationships are pinned against the stubbed fixture above.
    expect(risk.owner).to.equal(BORROWER);
    expect(risk.oraclePrice > 0n).to.equal(true);

    const hf = risk.healthFactor;
    if (risk.borrowAssets > 0n) {
      // Debt present => a health factor exists, and the two liquidation
      // signals must agree with each other whichever side of the line it is on.
      expect(hf !== undefined).to.equal(true);
      if (hf !== undefined) {
        expect(hf < WAD).to.equal(risk.isLiquidatable);
      }
      expect(risk.liquidationPrice !== undefined).to.equal(
        risk.collateral > 0n && risk.lltv > 0n,
      );
    } else {
      expect(hf).to.equal(undefined);
      expect(risk.isLiquidatable).to.equal(false);
    }
    // Capacity is bounded by liquidity by construction.
    expect(risk.borrowableAssets <= risk.borrowCapacityRemaining).to.equal(true);
  });
});
