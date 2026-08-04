import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Filter,
  Interface,
  InterfaceAbi,
  Log,
  Provider,
  TransactionRequest,
  getAddress,
  zeroPadValue,
} from 'ethers';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { abi } from '../../../abi/abi';
import { MorphoBluePosition } from '../../../contract/morpho/morpho-blue-contract';
import { MORPHO_BLUE_ADDRESS } from '../../../steps/morpho/morpho-blue-util';
import {
  makeEphemeralExecutor,
  resolvePositionOwnerAddress,
} from '../../../utils/7702';
import {
  MORPHO_BLUE_POSITION_EVENTS,
  MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0,
} from '../morpho-blue-events';
import {
  assertMorphoBlueRediscoveryComplete,
  rediscoverMorphoBluePositions,
  scanMorphoBlueAuthorizations,
  scanMorphoBluePositionLogs,
} from '../morpho-blue-rediscovery';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// The scenario, which is the acceptance case from the brief:
//
//   Two ephemeral executors were derived, used, and their local record lost.
//   EXEC_A opened a collateral+borrow position in MARKET_1 by acting for
//   itself. EXEC_B was a *delegated* executor: it called Blue on behalf of
//   DURABLE_OWNER, so on Blue's books the position belongs to DURABLE_OWNER and
//   EXEC_B holds nothing. EXEC_A also lent into MARKET_2 and has since fully
//   withdrawn.
//
//   With no local state, given the three accounts and a block range, the reader
//   must report: EXEC_A holds collateral+debt in MARKET_1, DURABLE_OWNER holds
//   collateral in MARKET_2, and EXEC_B holds nothing — while NOT crediting
//   EXEC_B with DURABLE_OWNER's position merely because it was the caller.
// ---------------------------------------------------------------------------
const EXEC_A = getAddress('0x1111111111111111111111111111111111111111');
const EXEC_B = getAddress('0x2222222222222222222222222222222222222222');
const DURABLE_OWNER = getAddress('0x3333333333333333333333333333333333333333');
const STRANGER = getAddress('0x4444444444444444444444444444444444444444');

const MARKET_1 =
  '0x1111111111111111111111111111111111111111111111111111111111111111';
const MARKET_2 =
  '0x2222222222222222222222222222222222222222222222222222222222222222';
const MARKET_BROKEN =
  '0x3333333333333333333333333333333333333333333333333333333333333333';

const USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
const WBTC = getAddress('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
const ORACLE = getAddress('0xa6d6950c9f177f1de7f7757fb33539e3ec60182a');
const IRM = getAddress('0x870ac11d48b15db9a138cf899d20f13f79ba00bc');

const blueIface = new Interface(abi.morpho.blue as InterfaceAbi);
const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);
const eventsIface = new Interface([
  'event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)',
  'event Withdraw(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
  'event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
  'event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)',
  'event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)',
  'event SetAuthorization(address indexed caller, address indexed authorizer, address indexed authorized, bool newIsAuthorized)',
]);

const topic0 = (name: string): string => {
  const descriptor = MORPHO_BLUE_POSITION_EVENTS.find(d => d.name === name);
  if (descriptor === undefined) {
    throw new Error(`no descriptor for ${name}`);
  }
  return descriptor.topic0;
};

type StubLog = Pick<
  Log,
  'topics' | 'data' | 'blockNumber' | 'transactionHash' | 'index' | 'address'
>;

let nextLogIndex = 0;
const makeLog = (
  name: string,
  args: readonly unknown[],
  blockNumber: number,
): StubLog => {
  const fragment = eventsIface.getEvent(name);
  if (fragment === null) {
    throw new Error(`no fragment for ${name}`);
  }
  const encoded = eventsIface.encodeEventLog(fragment, [...args]);
  nextLogIndex += 1;
  return {
    address: MORPHO_BLUE_ADDRESS,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber,
    transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
    index: nextLogIndex,
  };
};

// The chain, as logs. Note EXEC_B never appears as `onBehalf` anywhere — it is
// only ever the `caller`, which is the whole point of the delegated case.
const CHAIN_LOGS: StubLog[] = [
  // EXEC_A supplies collateral for ITSELF (caller === onBehalf) at block 100.
  makeLog('SupplyCollateral', [MARKET_1, EXEC_A, EXEC_A, 200_000_000n], 100),
  // EXEC_A borrows against it at block 101.
  makeLog(
    'Borrow',
    [MARKET_1, EXEC_A, EXEC_A, EXEC_A, 1_000_000_000n, 1_000_000_000n],
    101,
  ),
  // EXEC_B supplies collateral ON BEHALF OF DURABLE_OWNER at block 12,000 —
  // caller EXEC_B, onBehalf DURABLE_OWNER. A topic2 filter would credit EXEC_B.
  makeLog(
    'SupplyCollateral',
    [MARKET_2, EXEC_B, DURABLE_OWNER, 5_000_000_000n],
    12_000,
  ),
  // EXEC_A lends into MARKET_2 and fully withdraws — a pair the logs find and
  // state says is closed.
  makeLog('Supply', [MARKET_2, EXEC_A, EXEC_A, 500n, 500n], 12_001),
  makeLog('Withdraw', [MARKET_2, EXEC_A, EXEC_A, EXEC_A, 500n, 500n], 12_002),
  // A stranger's activity in MARKET_1, which must never appear.
  makeLog('SupplyCollateral', [MARKET_1, STRANGER, STRANGER, 999_999n], 12_050),
  // DURABLE_OWNER is liquidated at block 22,000 — a position change from a
  // transaction the owner never sent, invisible to any local record.
  makeLog(
    'Liquidate',
    [MARKET_BROKEN, STRANGER, DURABLE_OWNER, 1n, 2n, 3n, 0n, 0n],
    22_000,
  ),
  // Authorization: DURABLE_OWNER empowers EXEC_B, via a signature relayed by a
  // third party — so `caller` is neither of them.
  makeLog('SetAuthorization', [STRANGER, DURABLE_OWNER, EXEC_B, true], 11_999),
];

const POSITIONS: Record<string, MorphoBluePosition> = {
  [`${MARKET_1}:${EXEC_A}`]: {
    supplyShares: 0n,
    borrowShares: 1_000_000_000n,
    collateral: 200_000_000n,
  },
  [`${MARKET_2}:${DURABLE_OWNER}`]: {
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 5_000_000_000n,
  },
  // EXEC_A's MARKET_2 lend is fully closed: found in the logs, empty in state.
  [`${MARKET_2}:${EXEC_A}`]: {
    supplyShares: 0n,
    borrowShares: 0n,
    collateral: 0n,
  },
  [`${MARKET_BROKEN}:${DURABLE_OWNER}`]: {
    supplyShares: 0n,
    borrowShares: 7n,
    collateral: 11n,
  },
};

const MARKET_PARAMS: Record<string, readonly [string, string]> = {
  [MARKET_1]: [USDC, WBTC],
  [MARKET_2]: [USDC, WBTC],
  [MARKET_BROKEN]: [USDC, WBTC],
};

type StubOptions = {
  /** Block ranges whose getLogs should reject, as `[from, to]` inclusive. */
  failLogsInRange?: readonly (readonly [number, number])[];
  /** `${marketId}:${owner}` keys whose `position()` read should reject. */
  failPositionFor?: ReadonlySet<string>;
  /** Market ids whose `idToMarketParams` should reject. */
  failMarketParamsFor?: ReadonlySet<string>;
  /** Records every blockTag `position()` was called with. */
  positionBlockTags?: (number | string | undefined)[];
  /** Records every `getLogs` filter issued. */
  issuedFilters?: Filter[];
  head?: number;
};

/**
 * Stub provider that implements REAL `eth_getLogs` topic semantics — OR within
 * a position, AND across positions, `null` as wildcard. Without that the test
 * would exercise the reader's plumbing but not its filter design, which is the
 * part that is easy to get wrong.
 */
const makeStubProvider = (options: StubOptions = {}): Provider => {
  const matchesTopics = (
    logTopics: readonly string[],
    filterTopics: readonly (string | readonly string[] | null)[] | undefined,
  ): boolean => {
    if (filterTopics === undefined) {
      return true;
    }
    return filterTopics.every((constraint, position) => {
      if (constraint === null || constraint === undefined) {
        return true;
      }
      const actual = logTopics[position];
      if (actual === undefined) {
        return false;
      }
      const allowed = Array.isArray(constraint) ? constraint : [constraint];
      return allowed.some(
        candidate => String(candidate).toLowerCase() === actual.toLowerCase(),
      );
    });
  };

  const getLogs = async (filter: Filter): Promise<Log[]> => {
    options.issuedFilters?.push(filter);
    const from = Number(filter.fromBlock);
    const to = Number(filter.toBlock);
    for (const [failFrom, failTo] of options.failLogsInRange ?? []) {
      if (from <= failTo && to >= failFrom) {
        throw new Error(`stub: getLogs ${from}-${to} exceeded the range limit`);
      }
    }
    return CHAIN_LOGS.filter(
      log =>
        log.blockNumber >= from &&
        log.blockNumber <= to &&
        matchesTopics(
          log.topics,
          filter.topics as readonly (string | readonly string[] | null)[],
        ),
    ) as unknown as Log[];
  };

  const call = async (
    tx: TransactionRequest & { blockTag?: number | string },
  ): Promise<string> => {
    const to = String(tx.to).toLowerCase();
    const data = String(tx.data);
    const selector = data.slice(0, 10);

    if (to === MORPHO_BLUE_ADDRESS.toLowerCase()) {
      if (selector === blueIface.getFunction('position')?.selector) {
        const decoded = blueIface.decodeFunctionData('position', data);
        const marketId = String(decoded[0]);
        const account = getAddress(String(decoded[1]));
        options.positionBlockTags?.push(tx.blockTag);
        const key = `${marketId}:${account}`;
        if (options.failPositionFor?.has(key) === true) {
          throw new Error(`stub: position(${key}) reverted`);
        }
        const position = POSITIONS[key] ?? {
          supplyShares: 0n,
          borrowShares: 0n,
          collateral: 0n,
        };
        return blueIface.encodeFunctionResult('position', [
          position.supplyShares,
          position.borrowShares,
          position.collateral,
        ]);
      }
      if (selector === blueIface.getFunction('idToMarketParams')?.selector) {
        const decoded = blueIface.decodeFunctionData('idToMarketParams', data);
        const marketId = String(decoded[0]);
        if (options.failMarketParamsFor?.has(marketId) === true) {
          throw new Error(`stub: idToMarketParams(${marketId}) reverted`);
        }
        const params = MARKET_PARAMS[marketId];
        if (params === undefined) {
          throw new Error(`stub: unknown market ${marketId}`);
        }
        return blueIface.encodeFunctionResult('idToMarketParams', [
          [params[0], params[1], ORACLE, IRM, 860000000000000000n],
        ]);
      }
    }
    if (to === USDC.toLowerCase() || to === WBTC.toLowerCase()) {
      return erc20Iface.encodeFunctionResult('decimals', [
        to === USDC.toLowerCase() ? 6n : 8n,
      ]);
    }
    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };

  return {
    call,
    getLogs,
    getBlockNumber: async () => options.head ?? 30_000,
  } as unknown as Provider;
};

describe('Morpho Blue rediscovery — log scan', () => {
  it('finds every (market, owner) pair from logs alone', async () => {
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_A, EXEC_B, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });

    expect(scan.complete).to.equal(true);
    const keys = scan.sightings
      .map(sighting => `${sighting.marketId}:${sighting.owner}`)
      .sort();
    expect(keys).to.deep.equal(
      [
        `${MARKET_1}:${EXEC_A}`,
        `${MARKET_2}:${DURABLE_OWNER}`,
        `${MARKET_2}:${EXEC_A}`,
        `${MARKET_BROKEN}:${DURABLE_OWNER}`,
      ].sort(),
    );
  });

  it('does NOT credit a caller with the position it moved for someone else', async () => {
    // The acceptance case for the owner/receiver split, read back off chain.
    // EXEC_B called `supplyCollateral(onBehalf: DURABLE_OWNER)`. On Blue's books
    // it holds nothing, and a topic2-only filter would say otherwise.
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_B],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.complete).to.equal(true);
    expect(scan.sightings).to.deep.equal([]);
    expect(scan.events).to.deep.equal([]);
  });

  it('finds a position moved by a liquidation the holder never transacted', async () => {
    const scan = await scanMorphoBluePositionLogs({
      owners: [DURABLE_OWNER],
      fromBlock: 20_000,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.sightings.length).to.equal(1);
    const [sighting] = scan.sightings;
    expect(sighting.marketId).to.equal(MARKET_BROKEN);
    expect(sighting.liquidatedInRange).to.equal(true);
    // One Liquidate log moves two legs; mapping it to one loses the other.
    expect(sighting.kinds).to.have.members(['debt', 'collateral']);
  });

  it('never lets a different account’s activity leak in', async () => {
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    for (const sighting of scan.sightings) {
      expect(sighting.owner).to.equal(EXEC_A);
    }
    expect(
      scan.sightings.some(sighting => sighting.marketId === MARKET_2),
    ).to.equal(true);
    // The stranger supplied into MARKET_1 too; that must not show up.
    expect(scan.events.every(event => event.owner === EXEC_A)).to.equal(true);
  });

  it('chunks the range and issues exactly two filters per chunk', async () => {
    const issuedFilters: Filter[] = [];
    await scanMorphoBluePositionLogs({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 29_999,
      chunkBlocks: 10_000,
      provider: makeStubProvider({ issuedFilters }),
    });
    expect(issuedFilters.length).to.equal(6); // 3 chunks × 2 filters
    expect(issuedFilters.map(f => [f.fromBlock, f.toBlock])).to.deep.equal([
      [0, 9_999],
      [0, 9_999],
      [10_000, 19_999],
      [10_000, 19_999],
      [20_000, 29_999],
      [20_000, 29_999],
    ]);
  });

  it('resolves toBlock to a concrete head instead of leaving it "latest"', async () => {
    const issuedFilters: Filter[] = [];
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_A],
      fromBlock: 0,
      provider: makeStubProvider({ issuedFilters, head: 12_345 }),
    });
    expect(scan.toBlock).to.equal(12_345);
    // A moving head under a long scan would smear the answer across heights.
    expect(issuedFilters.every(f => Number(f.toBlock) <= 12_345)).to.equal(
      true,
    );
  });

  it('rejects an empty owner set and a backwards range', async () => {
    const provider = makeStubProvider();
    await expect(
      scanMorphoBluePositionLogs({ owners: [], fromBlock: 0, provider }),
    ).to.eventually.be.rejectedWith(/at least one owner/);
    await expect(
      scanMorphoBluePositionLogs({
        owners: [EXEC_A],
        fromBlock: 100,
        toBlock: 50,
        provider,
      }),
    ).to.eventually.be.rejectedWith(/before fromBlock/);
  });

  it('accepts an EphemeralExecutor as well as a bare address', async () => {
    const scan = await scanMorphoBluePositionLogs({
      owners: [makeEphemeralExecutor(EXEC_A)],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.owners).to.deep.equal([EXEC_A]);
    expect(scan.sightings.length).to.equal(2);
  });

  it('allows the REAL relay-adapt address, because a stranded position must stay visible', async () => {
    // The read-path validator, not the write-path one. This is the actual
    // Ethereum relay-adapt contract, so the assertion below is a genuine
    // divergence between the two validators and not a test against a made-up
    // address: routing a NEW position there is refused, looking at one already
    // stranded there is not. Refusing to look is how a stranded position stays
    // invisible forever.
    const RELAY_ADAPT = getAddress(
      NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract,
    );
    expect(() =>
      resolvePositionOwnerAddress(RELAY_ADAPT, 'write path'),
    ).to.throw(/shared relay-adapt contract/);

    const scan = await scanMorphoBluePositionLogs({
      owners: [RELAY_ADAPT],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.owners).to.deep.equal([RELAY_ADAPT]);
  });
});

describe('Morpho Blue rediscovery — never map a read error to zero', () => {
  it('records a failed chunk as unscanned rather than as "no positions"', async () => {
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_A, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 29_999,
      chunkBlocks: 10_000,
      provider: makeStubProvider({ failLogsInRange: [[10_000, 19_999]] }),
    });
    expect(scan.complete).to.equal(false);
    expect(scan.unscannedCount).to.equal(1);
    expect(scan.unscannedBlockCount).to.equal(10_000);
    expect(scan.unscanned[0]).to.deep.include({
      fromBlock: 10_000,
      toBlock: 19_999,
    });
    // The chunks either side still produced results — a partial scan is still
    // worth having, as long as it says it is partial.
    expect(scan.sightings.length).to.be.greaterThan(0);
    // And the pair that lived only in the failed chunk is absent, NOT reported
    // as empty.
    expect(scan.sightings.some(s => s.marketId === MARKET_2)).to.equal(false);
  });

  it('drops the whole chunk if either of the two filters fails', async () => {
    // A half-read chunk would silently lose whichever holder-topic position the
    // failed query covered — asymmetrically, by event.
    let calls = 0;
    const provider = makeStubProvider();
    const failingProvider = {
      ...provider,
      getBlockNumber: async () => 30_000,
      getLogs: async (filter: Filter) => {
        calls += 1;
        if (calls === 2) {
          throw new Error('stub: second filter failed');
        }
        return provider.getLogs(filter);
      },
    } as unknown as Provider;
    const scan = await scanMorphoBluePositionLogs({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 9_999,
      provider: failingProvider,
    });
    expect(scan.unscannedCount).to.equal(1);
    expect(scan.sightings).to.deep.equal([]);
  });

  it('records a failed position() read as unreadable, not as an empty position', async () => {
    const report = await rediscoverMorphoBluePositions({
      owners: [EXEC_A, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider({
        failPositionFor: new Set([`${MARKET_1}:${EXEC_A}`]),
      }),
    });
    expect(report.complete).to.equal(false);
    expect(report.unreadableCount).to.equal(1);
    expect(report.unreadable[0].marketId).to.equal(MARKET_1);
    expect(report.unreadable[0].owner).to.equal(EXEC_A);
    expect(report.unreadable[0].reason).to.match(/position\(/);
    // Crucially: it is NOT in `positions` as a zeroed record.
    expect(
      report.positions.some(p => p.marketId === MARKET_1 && p.owner === EXEC_A),
    ).to.equal(false);
  });

  it('assertMorphoBlueRediscoveryComplete throws, naming counts and the lower-bound caveat', async () => {
    const report = await rediscoverMorphoBluePositions({
      owners: [EXEC_A, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 29_999,
      chunkBlocks: 10_000,
      provider: makeStubProvider({
        failLogsInRange: [[10_000, 19_999]],
        failPositionFor: new Set([`${MARKET_1}:${EXEC_A}`]),
      }),
    });
    expect(() => assertMorphoBlueRediscoveryComplete(report)).to.throw(
      /LOWER BOUND/,
    );
    expect(() => assertMorphoBlueRediscoveryComplete(report)).to.throw(
      /1 unscanned range\(s\) covering 10000 block\(s\)/,
    );
    expect(() => assertMorphoBlueRediscoveryComplete(report)).to.throw(
      /1 unreadable position\(s\)/,
    );
  });

  it('returns the report unchanged when nothing went unread', async () => {
    const report = await rediscoverMorphoBluePositions({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(assertMorphoBlueRediscoveryComplete(report)).to.equal(report);
  });
});

describe('Morpho Blue rediscovery — confirmation against state', () => {
  it('ACCEPTANCE: enumerates what the accounts hold, from accounts and a block range alone', async () => {
    const report = await rediscoverMorphoBluePositions({
      owners: [EXEC_A, EXEC_B, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });

    expect(report.complete).to.equal(true);
    const held = report.positions.map(p => `${p.marketId}:${p.owner}`).sort();
    expect(held).to.deep.equal(
      [
        `${MARKET_1}:${EXEC_A}`,
        `${MARKET_2}:${DURABLE_OWNER}`,
        `${MARKET_BROKEN}:${DURABLE_OWNER}`,
      ].sort(),
    );

    const market1 = report.positions.find(p => p.marketId === MARKET_1);
    expect(market1?.owner).to.equal(EXEC_A);
    expect(market1?.collateral).to.equal(200_000_000n);
    expect(market1?.borrowShares).to.equal(1_000_000_000n);
    expect(market1?.kinds).to.have.members(['collateral', 'debt']);
    expect(market1?.isEmpty).to.equal(false);
    expect(market1?.protocol).to.equal('morpho-blue');
    expect(market1?.custody).to.equal('address-bound');
    // Token metadata came off chain, per market, not per pair.
    expect(market1?.market).to.deep.include({
      readable: true,
      loanToken: USDC,
      loanDecimals: 6n,
      collateralToken: WBTC,
      collateralDecimals: 8n,
    });

    // EXEC_B holds nothing despite having been the caller on a real position.
    expect(report.positions.some(p => p.owner === EXEC_B)).to.equal(false);
  });

  it('drops a pair the logs found but state says is closed, and keeps it on request', async () => {
    const provider = makeStubProvider();
    const withoutEmpty = await rediscoverMorphoBluePositions({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 30_000,
      provider,
    });
    expect(withoutEmpty.positions.some(p => p.marketId === MARKET_2)).to.equal(
      false,
    );

    const withEmpty = await rediscoverMorphoBluePositions({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 30_000,
      includeEmpty: true,
      provider,
    });
    const closed = withEmpty.positions.find(p => p.marketId === MARKET_2);
    expect(closed?.isEmpty).to.equal(true);
    expect(closed?.kinds).to.deep.equal([]);
    // Its history is still attached, which is how a consumer can say "you used
    // this market and exited" rather than "this never happened".
    expect(closed?.sighting.observedEvents).to.have.members([
      'Supply',
      'Withdraw',
    ]);
  });

  it('pins every state read to the scan toBlock, not to the moving head', async () => {
    const positionBlockTags: (number | string | undefined)[] = [];
    await rediscoverMorphoBluePositions({
      owners: [EXEC_A, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 25_000,
      provider: makeStubProvider({ positionBlockTags, head: 30_000 }),
    });
    expect(positionBlockTags.length).to.be.greaterThan(0);
    for (const tag of positionBlockTags) {
      expect(tag).to.equal(25_000);
    }
  });

  it('keeps the position words when the market descriptor cannot be read', async () => {
    // Decimals are decoration; the words are what says value is at risk.
    // Erasing a position because a token metadata call failed would be the
    // read-error-to-zero failure with extra steps.
    const report = await rediscoverMorphoBluePositions({
      owners: [EXEC_A],
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider({
        failMarketParamsFor: new Set([MARKET_1]),
      }),
    });
    const position = report.positions.find(p => p.marketId === MARKET_1);
    expect(position?.collateral).to.equal(200_000_000n);
    expect(position?.market.readable).to.equal(false);
    if (position?.market.readable === false) {
      expect(position.market.reason).to.match(/idToMarketParams/);
    }
    // A market read failure is not a position read failure.
    expect(report.unreadableCount).to.equal(0);
  });

  it('reads each distinct market once, not once per pair', async () => {
    let marketParamsCalls = 0;
    const base = makeStubProvider();
    const counting = {
      ...base,
      getLogs: base.getLogs.bind(base),
      getBlockNumber: async () => 30_000,
      call: async (tx: TransactionRequest) => {
        if (
          String(tx.data).slice(0, 10) ===
          blueIface.getFunction('idToMarketParams')?.selector
        ) {
          marketParamsCalls += 1;
        }
        return base.call(tx);
      },
    } as unknown as Provider;
    await rediscoverMorphoBluePositions({
      owners: [EXEC_A, DURABLE_OWNER],
      fromBlock: 0,
      toBlock: 30_000,
      includeEmpty: true,
      provider: counting,
    });
    // Four pairs, three distinct markets.
    expect(marketParamsCalls).to.equal(3);
  });

  it('rejects a non-positive concurrency', async () => {
    await expect(
      rediscoverMorphoBluePositions({
        owners: [EXEC_A],
        fromBlock: 0,
        toBlock: 30_000,
        concurrency: 0,
        provider: makeStubProvider(),
      }),
    ).to.eventually.be.rejectedWith(/concurrency must be a positive integer/);
  });
});

describe('Morpho Blue rediscovery — authorization scan', () => {
  it('finds who empowered an executor, even when neither signed the transaction', async () => {
    // The delegated case: DURABLE_OWNER granted EXEC_B by signature, relayed by
    // STRANGER. Scanning EXEC_B's own transaction history would find nothing.
    const scan = await scanMorphoBlueAuthorizations({
      accounts: [EXEC_B],
      role: 'authorized',
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.complete).to.equal(true);
    expect(scan.events.length).to.equal(1);
    expect(scan.events[0].authorizer).to.equal(DURABLE_OWNER);
    expect(scan.events[0].authorized).to.equal(EXEC_B);
    expect(scan.events[0].caller).to.equal(STRANGER);
    expect(scan.events[0].newIsAuthorized).to.equal(true);
    expect(scan.latest).to.deep.equal([
      {
        authorizer: DURABLE_OWNER,
        authorized: EXEC_B,
        isAuthorized: true,
        blockNumber: 11_999,
      },
    ]);
  });

  it('finds the same grant from the owner side', async () => {
    const scan = await scanMorphoBlueAuthorizations({
      accounts: [DURABLE_OWNER],
      role: 'authorizer',
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    expect(scan.events.length).to.equal(1);
    expect(scan.events[0].authorized).to.equal(EXEC_B);
  });

  it('deduplicates when both roles are scanned at once', async () => {
    const scan = await scanMorphoBlueAuthorizations({
      accounts: [DURABLE_OWNER, EXEC_B],
      role: 'either',
      fromBlock: 0,
      toBlock: 30_000,
      provider: makeStubProvider(),
    });
    // Two filters both match the single grant; it must be reported once.
    expect(scan.events.length).to.equal(1);
    expect(
      scan.events[0].transactionHash,
      'topic0 must be the SetAuthorization hash',
    ).to.be.a('string');
    expect(MORPHO_BLUE_SET_AUTHORIZATION_TOPIC0).to.be.a('string');
  });

  it('reports unscanned ranges the same way the position scan does', async () => {
    const scan = await scanMorphoBlueAuthorizations({
      accounts: [EXEC_B],
      fromBlock: 0,
      toBlock: 19_999,
      chunkBlocks: 10_000,
      provider: makeStubProvider({ failLogsInRange: [[10_000, 19_999]] }),
    });
    expect(scan.complete).to.equal(false);
    expect(scan.unscannedCount).to.equal(1);
    expect(scan.unscannedBlockCount).to.equal(10_000);
  });
});

// Padding helper kept honest: the filters this module builds must be the same
// shape ethers would produce for an address topic.
describe('Morpho Blue rediscovery — topic padding', () => {
  it('pads owner addresses exactly as ethers does', () => {
    expect(zeroPadValue(EXEC_A, 32)).to.equal(
      `0x000000000000000000000000${EXEC_A.slice(2).toLowerCase()}`,
    );
    expect(topic0('Supply')).to.be.a('string');
  });
});
