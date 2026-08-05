import chai from 'chai';
import { JsonRpcProvider } from 'ethers';
import {
  MORPHO_BLUE_CREATE_MARKET_TOPIC0,
  MORPHO_BLUE_FIRST_MARKET_BLOCK,
  filterMorphoBlueMarkets,
  scanMorphoBlueMarkets,
  type MorphoBlueMarketScan,
} from '../morpho-blue-market-discovery';
import { getMarketId } from '../../../steps/morpho/morpho-blue-util';

const { expect } = chai;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'; // pragma: allowlist secret

/**
 * Real `CreateMarket` logs, captured from the deployed singleton at the blocks
 * named. Recorded rather than fetched live because the common public endpoints
 * refuse `eth_getLogs` outright (publicnode answers 403), which would make this
 * a test of RPC entitlements instead of the decoder. These bytes are what
 * mainnet actually emitted; a stub provider replays them.
 */
const REAL_LOGS = [
  {
    // WETH / wstETH, 94.5% LLTV — the very first Blue market.
    blockNumber: 18_919_623,
    topics: [
      '0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac',
      '0xc54d7acf14de29e0e5527cabd7a576506870346a78a11a6762e2cca66322ec41',
    ],
    data:
      '0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' +
      '0000000000000000000000007f39c581f595b53c5cb19bd0b3f8da6c935e2ca0' +
      '0000000000000000000000002a01eb9496094da03c4e364def50f5ad1280ad72' +
      '000000000000000000000000870ac11d48b15db9a138cf899d20f13f79ba00bc' +
      '0000000000000000000000000000000000000000000000000d1d507e40be8000',
  },
  {
    // An IDLE market: USDC loan token, everything else zero. Real, and a lender
    // routed here earns nothing forever.
    blockNumber: 18_919_858,
    topics: [
      '0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac',
      '0x54efdee08e272e929034a8f26f7ca34b1ebe364b275391169b28c6d7db24dbc8',
    ],
    data:
      '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' +
      '0000000000000000000000000000000000000000000000000000000000000000'.repeat(
        4,
      ),
  },
];

/** Replays {@link REAL_LOGS} for any range covering their blocks. */
const stubProvider = (
  logs: typeof REAL_LOGS = REAL_LOGS,
  failGetLogs = false,
): JsonRpcProvider =>
  ({
    getBlockNumber: async () => 18_930_000,
    getLogs: async ({
      fromBlock,
      toBlock,
    }: {
      fromBlock: number;
      toBlock: number;
    }) => {
      if (failGetLogs) {
        throw new Error('eth_getLogs is not supported by this endpoint');
      }
      return logs.filter(
        log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
      );
    },
  }) as unknown as JsonRpcProvider;

describe('scanMorphoBlueMarkets', function run() {
  this.timeout(60_000);

  let scan: MorphoBlueMarketScan;

  before(async () => {
    scan = await scanMorphoBlueMarkets({
      provider: stubProvider(),
      fromBlock: MORPHO_BLUE_FIRST_MARKET_BLOCK,
      toBlock: MORPHO_BLUE_FIRST_MARKET_BLOCK + 200_000,
      chunkSize: 50_000,
    });
  });

  it('Should compute the CreateMarket topic0 that mainnet actually emits', () => {
    // Measured against the deployed singleton. A mismatch here means the event
    // signature drifted and every scan below is silently empty.
    expect(MORPHO_BLUE_CREATE_MARKET_TOPIC0).to.equal(
      '0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac',
    );
  });

  it('Should decode the exact bytes mainnet emitted', () => {
    expect(scan.complete).to.equal(true);
    expect(scan.markets).to.have.length(2);
    expect(scan.idMismatches).to.deep.equal([]);

    const first = scan.markets[0];
    expect(first.params.loanToken.toLowerCase()).to.equal(
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
    );
    expect(first.params.collateralToken.toLowerCase()).to.equal(
      '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0', // wstETH
    );
    expect(first.params.lltv).to.equal(945_000_000_000_000_000n);
  });

  it('Should flag an idle market rather than presenting it as lendable', () => {
    const idle = scan.markets[1];
    // Zero IRM means the position accrues NOTHING — and nothing about the
    // market looks broken from the outside. Measured on mainnet: 73 of 1,708
    // markets have a zero IRM, 51 of them fully idle.
    expect(idle.accruesInterest).to.equal(false);
    expect(idle.borrowable).to.equal(false);
    expect(scan.markets[0].accruesInterest).to.equal(true);
    expect(scan.markets[0].borrowable).to.equal(true);
  });

  it('Should self-verify every id against its own params', () => {
    // A market id IS keccak(abi.encode(params)), so the log carries the same
    // fact twice and the reader recomputes rather than trusting either copy.
    scan.markets.forEach(market => {
      expect(market.idVerified).to.equal(true);
      expect(market.marketId).to.equal(getMarketId(market.params));
    });
  });

  it('Should emit no duplicate ids', () => {
    const ids = new Set(scan.markets.map(m => m.marketId.toLowerCase()));
    expect(ids.size).to.equal(scan.markets.length);
  });

  it('Should carry complete market params', () => {
    const market = scan.markets[0];
    expect(market.params.loanToken).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(market.params.collateralToken).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(market.params.oracle).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(market.params.irm).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(market.params.lltv > 0n).to.equal(true);
    expect(market.createdAtBlock >= MORPHO_BLUE_FIRST_MARKET_BLOCK).to.equal(
      true,
    );
  });

  it('Should report a failed range instead of returning an empty scan', async () => {
    // Not hypothetical: publicnode refuses eth_getLogs with a 403, so this is
    // the behaviour a caller on a common endpoint actually gets. "No markets"
    // and "could not look" must stay distinguishable.
    const failed = await scanMorphoBlueMarkets({
      provider: stubProvider(REAL_LOGS, true),
      fromBlock: MORPHO_BLUE_FIRST_MARKET_BLOCK,
      toBlock: MORPHO_BLUE_FIRST_MARKET_BLOCK + 10,
    });
    expect(failed.markets).to.deep.equal([]);
    expect(failed.complete).to.equal(false);
    expect(failed.unscanned.length > 0).to.equal(true);
    expect(failed.unscanned[0].reason).to.match(/getLogs/);
  });

  it('Should reject a non-positive chunk size', async () => {
    let threw = false;
    try {
      await scanMorphoBlueMarkets({ provider: stubProvider(), chunkSize: 0 });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});

describe('filterMorphoBlueMarkets', () => {
  const market = (
    loanToken: string,
    collateralToken: string,
    lltv: bigint,
    irm = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC', // pragma: allowlist secret
  ) => {
    const params = {
      loanToken,
      collateralToken,
      oracle: '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2', // pragma: allowlist secret
      irm,
      lltv,
    };
    return {
      marketId: getMarketId(params),
      params,
      createdAtBlock: 19_000_000,
      idVerified: true,
      accruesInterest: irm !== '0x0000000000000000000000000000000000000000',
      borrowable:
        collateralToken !== '0x0000000000000000000000000000000000000000' &&
        lltv > 0n,
    };
  };

  const scan = (markets: ReturnType<typeof market>[]): MorphoBlueMarketScan => ({
    markets,
    unscanned: [],
    idMismatches: [],
    complete: true,
    fromBlock: MORPHO_BLUE_FIRST_MARKET_BLOCK,
    toBlock: 20_000_000,
  });

  const usdcWsteth = market(USDC, WSTETH, 860_000_000_000_000_000n);
  const usdcWstethLowLltv = market(USDC, WSTETH, 625_000_000_000_000_000n);
  const wstethUsdc = market(WSTETH, USDC, 860_000_000_000_000_000n);
  const all = scan([usdcWsteth, usdcWstethLowLltv, wstethUsdc]);

  it('Should filter by loan token, case-insensitively', () => {
    const found = filterMorphoBlueMarkets(all, {
      loanToken: USDC.toLowerCase(),
    });
    expect(found).to.have.length(2);
    found.forEach(m =>
      expect(m.params.loanToken.toLowerCase()).to.equal(USDC.toLowerCase()),
    );
  });

  it('Should distinguish the loan side from the collateral side', () => {
    // USDC/wstETH and wstETH/USDC are different markets with opposite risk.
    // A filter that conflated them would route a lender into a borrow market.
    const lending = filterMorphoBlueMarkets(all, { loanToken: USDC });
    const borrowing = filterMorphoBlueMarkets(all, { collateralToken: USDC });
    expect(lending).to.have.length(2);
    expect(borrowing).to.have.length(1);
    expect(lending.map(m => m.marketId)).to.not.contain(
      borrowing[0].marketId,
    );
  });

  it('Should filter by an lltv range', () => {
    const conservative = filterMorphoBlueMarkets(all, {
      loanToken: USDC,
      maxLltv: 700_000_000_000_000_000n,
    });
    expect(conservative).to.have.length(1);
    expect(conservative[0].params.lltv).to.equal(625_000_000_000_000_000n);
  });

  it('Should combine criteria conjunctively', () => {
    expect(
      filterMorphoBlueMarkets(all, {
        loanToken: USDC,
        collateralToken: WSTETH,
        minLltv: 800_000_000_000_000_000n,
      }),
    ).to.have.length(1);
  });

  it('Should return everything when no criteria are given', () => {
    expect(filterMorphoBlueMarkets(all, {})).to.have.length(3);
  });

  it('Should drop zero-IRM markets when the caller asks for yield', () => {
    const idle = market(
      USDC,
      '0x0000000000000000000000000000000000000000',
      0n,
      '0x0000000000000000000000000000000000000000',
    );
    const withIdle = scan([usdcWsteth, idle]);

    // A lender filtering only by loan token gets both, and the idle one pays
    // nothing forever while looking perfectly normal.
    expect(filterMorphoBlueMarkets(withIdle, { loanToken: USDC })).to.have.length(
      2,
    );
    expect(
      filterMorphoBlueMarkets(withIdle, {
        loanToken: USDC,
        accruesInterestOnly: true,
      }),
    ).to.have.length(1);
    expect(
      filterMorphoBlueMarkets(withIdle, {
        loanToken: USDC,
        borrowableOnly: true,
      }),
    ).to.have.length(1);
  });

  it('Should never surface an id-mismatched market', () => {
    const bad = { ...usdcWsteth, marketId: '0xdead', idVerified: false };
    const withMismatch: MorphoBlueMarketScan = {
      ...all,
      markets: [usdcWstethLowLltv],
      idMismatches: [bad],
    };
    // A market whose id does not derive from its own params must not be routed
    // to, so it is excluded by construction rather than by a flag check.
    const found = filterMorphoBlueMarkets(withMismatch, { loanToken: USDC });
    expect(found.map(m => m.marketId)).to.not.contain('0xdead');
  });
});
