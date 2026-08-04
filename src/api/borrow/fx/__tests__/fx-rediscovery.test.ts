import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  NFTTokenType,
  NETWORK_CONFIG,
  NetworkName,
} from '@railgun-community/shared-models';
import {
  Filter,
  Interface,
  Log,
  Provider,
  TransactionRequest,
  ZeroAddress,
  getAddress,
  id as keccakId,
} from 'ethers';
import {
  KNOWN_POOLS,
  fxPositionTokenSubID,
  resolvePool,
} from '../../../../steps/borrow/fx/fx-mint-util';
import {
  ERC721_TRANSFER_TOPIC0,
  assertFxRediscoveryComplete,
  rediscoverFxPositions,
  scanFxPositionTransfers,
} from '../fx-rediscovery';

chai.use(chaiAsPromised);
const { expect } = chai;

// ---------------------------------------------------------------------------
// The bearer scenario, which is the mirror of the Morpho Blue one.
//
//   EXEC_A opened an f(x) position and the batch's shield leg SUCCEEDED, so the
//   NFT now sits with the RAILGUN relay adapter. A reader that reported only
//   "tokens these accounts hold" would say EXEC_A has nothing — reporting the
//   success path as an absence.
//
//   EXEC_B opened one and the shield leg never ran, so it still holds the token.
//   That is the stranded case from brief §4.1, and the one that needs surfacing.
//
//   EXEC_A also has a closed position: still a live NFT (f(x) does not burn),
//   holding (0, 0).
// ---------------------------------------------------------------------------
const EXEC_A = getAddress('0x1111111111111111111111111111111111111111');
const EXEC_B = getAddress('0x2222222222222222222222222222222222222222');
const STRANGER = getAddress('0x4444444444444444444444444444444444444444');
const RELAY_ADAPT = getAddress(
  NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract,
);

const WSTETH_LONG = resolvePool('wstETH-Long');
const WBTC_SHORT = resolvePool('WBTC-Short');

const SHIELDED_ID = 480n;
const STRANDED_ID = 902n;
const CLOSED_ID = 12n;
const BURNED_ID = 13n;
const UNREADABLE_ID = 77n;
const HANDOFF_ID = 1_500n;

const transferIface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const poolIface = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function getPosition(uint256) view returns (uint256, uint256)',
]);

type StubLog = Pick<
  Log,
  'topics' | 'data' | 'blockNumber' | 'transactionHash' | 'index' | 'address'
>;

let nextIndex = 0;
const transferLog = (
  pool: string,
  from: string,
  to: string,
  tokenId: bigint,
  blockNumber: number,
): StubLog => {
  const fragment = transferIface.getEvent('Transfer');
  if (fragment === null) {
    throw new Error('no Transfer fragment');
  }
  const encoded = transferIface.encodeEventLog(fragment, [from, to, tokenId]);
  nextIndex += 1;
  return {
    address: pool,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber,
    transactionHash: `0x${(nextIndex + blockNumber)
      .toString(16)
      .padStart(64, '0')}`,
    index: nextIndex,
  };
};

const CHAIN_LOGS: StubLog[] = [
  // EXEC_A mints, then the shield leg moves it to the relay adapter.
  transferLog(WSTETH_LONG.address, ZeroAddress, EXEC_A, SHIELDED_ID, 100),
  transferLog(WSTETH_LONG.address, EXEC_A, RELAY_ADAPT, SHIELDED_ID, 100),
  // EXEC_B mints and keeps it — the shield never happened.
  transferLog(WSTETH_LONG.address, ZeroAddress, EXEC_B, STRANDED_ID, 5_000),
  // EXEC_A's closed position on the short pool. Never burned.
  transferLog(WBTC_SHORT.address, ZeroAddress, EXEC_A, CLOSED_ID, 6_000),
  // A token that WAS burned, to prove the classification is not dead code.
  transferLog(WBTC_SHORT.address, ZeroAddress, EXEC_A, BURNED_ID, 6_001),
  transferLog(WBTC_SHORT.address, EXEC_A, ZeroAddress, BURNED_ID, 6_002),
  // A token whose confirming read fails.
  transferLog(WBTC_SHORT.address, ZeroAddress, EXEC_A, UNREADABLE_ID, 6_003),
  // A handoff BETWEEN two scanned executors. This one log matches BOTH the
  // outgoing and the incoming filter, so it arrives twice.
  transferLog(WSTETH_LONG.address, EXEC_B, EXEC_A, HANDOFF_ID, 7_000),
  // Somebody else's position, which must never appear.
  transferLog(WSTETH_LONG.address, ZeroAddress, STRANGER, 999n, 15_000),
];

const OWNERS: Record<string, string> = {
  [`${WSTETH_LONG.address}:${SHIELDED_ID}`]: RELAY_ADAPT,
  [`${WSTETH_LONG.address}:${STRANDED_ID}`]: EXEC_B,
  [`${WBTC_SHORT.address}:${CLOSED_ID}`]: EXEC_A,
  [`${WBTC_SHORT.address}:${BURNED_ID}`]: ZeroAddress,
  [`${WSTETH_LONG.address}:999`]: STRANGER,
  [`${WSTETH_LONG.address}:${HANDOFF_ID}`]: EXEC_A,
};

const RAW_POSITIONS: Record<string, readonly [bigint, bigint]> = {
  [`${WSTETH_LONG.address}:${SHIELDED_ID}`]: [
    406858826466293299871n,
    597616991490708744098641n,
  ],
  [`${WSTETH_LONG.address}:${STRANDED_ID}`]: [1_000n, 2_000n],
  [`${WBTC_SHORT.address}:${CLOSED_ID}`]: [0n, 0n],
  [`${WBTC_SHORT.address}:${BURNED_ID}`]: [0n, 0n],
  [`${WSTETH_LONG.address}:999`]: [5n, 5n],
  [`${WSTETH_LONG.address}:${HANDOFF_ID}`]: [7n, 9n],
};

type StubOptions = {
  failLogsForPool?: ReadonlySet<string>;
  failLogsInRange?: readonly (readonly [number, number])[];
  blockTags?: (number | string | undefined)[];
  issuedFilters?: Filter[];
  head?: number;
};

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
    const address = String(filter.address);
    if (options.failLogsForPool?.has(address) === true) {
      throw new Error(`stub: getLogs failed for pool ${address}`);
    }
    const from = Number(filter.fromBlock);
    const to = Number(filter.toBlock);
    for (const [failFrom, failTo] of options.failLogsInRange ?? []) {
      if (from <= failTo && to >= failFrom) {
        throw new Error(`stub: getLogs ${from}-${to} exceeded the range limit`);
      }
    }
    return CHAIN_LOGS.filter(
      log =>
        log.address.toLowerCase() === address.toLowerCase() &&
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
    const to = getAddress(String(tx.to));
    const data = String(tx.data);
    const selector = data.slice(0, 10);
    options.blockTags?.push(tx.blockTag);

    if (selector === poolIface.getFunction('ownerOf')?.selector) {
      const [tokenId] = poolIface.decodeFunctionData('ownerOf', data);
      const key = `${to}:${String(tokenId)}`;
      const owner = OWNERS[key];
      if (owner === undefined) {
        // ERC-721 reverts for a token that does not exist. Here it stands in
        // for any confirming-read failure.
        throw new Error(`stub: ownerOf(${String(tokenId)}) reverted`);
      }
      return poolIface.encodeFunctionResult('ownerOf', [owner]);
    }
    if (selector === poolIface.getFunction('getPosition')?.selector) {
      const [tokenId] = poolIface.decodeFunctionData('getPosition', data);
      const key = `${to}:${String(tokenId)}`;
      // Deliberately mirrors the real contract: getPosition NEVER reverts, it
      // returns (0, 0) for an id that does not exist.
      const raw = RAW_POSITIONS[key] ?? ([0n, 0n] as const);
      return poolIface.encodeFunctionResult('getPosition', [raw[0], raw[1]]);
    }
    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };

  return {
    call,
    getLogs,
    getBlockNumber: async () => options.head ?? 20_000,
  } as unknown as Provider;
};

describe('f(x) rediscovery — the ERC-721 Transfer fragment', () => {
  it('uses the canonical Transfer topic0, taken from the shipped ERC-721 ABI', () => {
    expect(ERC721_TRANSFER_TOPIC0).to.equal(
      keccakId('Transfer(address,address,uint256)'),
    );
  });

  it('treats every pool as its own NFT contract', () => {
    // f(x) pools ARE the collection, so `pool.address` is both the venue id and
    // the NFT address. Nothing else has to be looked up to build a filter.
    for (const pool of KNOWN_POOLS) {
      const resolved = resolvePool(pool.name);
      expect(resolved.address).to.equal(pool.address);
    }
  });
});

describe('f(x) rediscovery — log scan', () => {
  it('finds tokens the accounts received AND tokens they sent away', async () => {
    const scan = await scanFxPositionTransfers({
      accounts: [EXEC_A, EXEC_B],
      fromBlock: 0,
      toBlock: 20_000,
      provider: makeStubProvider(),
    });
    expect(scan.complete).to.equal(true);
    const ids = scan.sightings
      .map(s => s.positionId)
      .sort((a, b) => (a < b ? -1 : 1));
    expect(ids).to.deep.equal(
      [
        CLOSED_ID,
        BURNED_ID,
        UNREADABLE_ID,
        SHIELDED_ID,
        STRANDED_ID,
        HANDOFF_ID,
      ].sort((a, b) => (a < b ? -1 : 1)),
    );
    // The stranger's token is never picked up.
    expect(scan.sightings.some(s => s.positionId === 999n)).to.equal(false);
  });

  it('carries the same NFT identity triple as a build-time bearer position record', async () => {
    const scan = await scanFxPositionTransfers({
      accounts: [EXEC_B],
      fromBlock: 0,
      toBlock: 20_000,
      provider: makeStubProvider(),
    });
    const [sighting] = scan.sightings;
    expect(sighting.protocol).to.equal('fx');
    expect(sighting.custody).to.equal('bearer');
    expect(sighting.nftAddress).to.equal(WSTETH_LONG.address);
    expect(sighting.nftTokenType).to.equal(NFTTokenType.ERC721);
    // Derived by the SAME helper every fx step uses, so the two join.
    expect(sighting.tokenSubID).to.equal(fxPositionTokenSubID(STRANDED_ID));
    expect(sighting.poolName).to.equal('wstETH-Long');
    expect(sighting.side).to.equal('long');
  });

  it('flags a mint to a scanned account', async () => {
    const scan = await scanFxPositionTransfers({
      accounts: [EXEC_A],
      fromBlock: 0,
      toBlock: 20_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    const shielded = scan.sightings.find(s => s.positionId === SHIELDED_ID);
    expect(shielded?.mintedInRange).to.equal(true);
    expect(shielded?.receivedInRange).to.equal(true);
    // It left again in the same block — that is the shield leg.
    expect(shielded?.sentInRange).to.equal(true);
    expect(shielded?.transferCount).to.equal(2);
  });

  it('counts a transfer between two scanned accounts once, not twice', async () => {
    // The outgoing filter (from ∈ accounts) and the incoming filter
    // (to ∈ accounts) BOTH match a handoff between two scanned executors, so the
    // same log arrives twice. Counting it twice would inflate `transferCount`
    // exactly for the multi-executor case this reader exists to serve.
    const both = await scanFxPositionTransfers({
      accounts: [EXEC_A, EXEC_B],
      fromBlock: 7_000,
      toBlock: 7_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    const [sighting] = both.sightings;
    expect(sighting.positionId).to.equal(HANDOFF_ID);
    expect(sighting.transferCount).to.equal(1);
    expect(sighting.receivedInRange).to.equal(true);
    expect(sighting.sentInRange).to.equal(true);

    // With only one of the two scanned, exactly one filter matches — same count,
    // which is what makes the assertion above about dedupe and not about luck.
    const onlyA = await scanFxPositionTransfers({
      accounts: [EXEC_A],
      fromBlock: 7_000,
      toBlock: 7_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    expect(onlyA.sightings[0].transferCount).to.equal(1);
    expect(onlyA.sightings[0].receivedInRange).to.equal(true);
    expect(onlyA.sightings[0].sentInRange).to.equal(false);
  });

  it('scans every KNOWN_POOL by default', async () => {
    const issuedFilters: Filter[] = [];
    await scanFxPositionTransfers({
      accounts: [EXEC_A],
      fromBlock: 0,
      toBlock: 9_999,
      provider: makeStubProvider({ issuedFilters }),
    });
    const addresses = new Set(issuedFilters.map(f => String(f.address)));
    expect(addresses.size).to.equal(KNOWN_POOLS.length);
    // Two filters (in / out) per pool per chunk.
    expect(issuedFilters.length).to.equal(KNOWN_POOLS.length * 2);
  });

  it('rejects an empty account set instead of scanning the whole chain', async () => {
    await expect(
      scanFxPositionTransfers({
        accounts: [],
        fromBlock: 0,
        provider: makeStubProvider(),
      }),
    ).to.eventually.be.rejectedWith(/at least one account/);
  });
});

describe('f(x) rediscovery — custody classification', () => {
  it('ACCEPTANCE: reports the shielded position rather than reporting nothing', async () => {
    // The failure this classification exists to prevent: on the SUCCESS path a
    // 7702 fx position is owned by the relay adapter, not by the executor. A
    // "tokens you hold" reader answers "none" for a position that is perfectly
    // fine.
    const report = await rediscoverFxPositions({
      accounts: [EXEC_A],
      fromBlock: 0,
      toBlock: 20_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    expect(report.complete).to.equal(true);
    expect(report.positions.length).to.equal(2);

    const shielded = report.positions.find(p => p.positionId === SHIELDED_ID);
    expect(shielded?.custodyStatus).to.equal('elsewhere');
    expect(shielded?.currentOwner).to.equal(RELAY_ADAPT);
    expect(shielded?.isEmpty).to.equal(false);
    expect(shielded?.rawColls).to.equal(406858826466293299871n);
    expect(shielded?.rawDebts).to.equal(597616991490708744098641n);

    // And the one it was handed still IS held, so the two statuses are told
    // apart in the same report rather than by the reader having only one mode.
    const handoff = report.positions.find(p => p.positionId === HANDOFF_ID);
    expect(handoff?.custodyStatus).to.equal('held');
    expect(handoff?.currentOwner).to.equal(EXEC_A);
  });

  it('reports a position the executor still holds as stranded, not as shielded', async () => {
    const report = await rediscoverFxPositions({
      accounts: [EXEC_B],
      fromBlock: 0,
      toBlock: 20_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    const [position] = report.positions;
    expect(position.positionId).to.equal(STRANDED_ID);
    expect(position.custodyStatus).to.equal('held');
    expect(position.currentOwner).to.equal(EXEC_B);
  });

  it('reports a closed position as a live NFT holding nothing', async () => {
    // Measured on mainnet: f(x) does not burn on close. A closed position keeps
    // answering `ownerOf` and reports (0, 0) from `getPosition`.
    const report = await rediscoverFxPositions({
      accounts: [EXEC_A],
      fromBlock: 6_000,
      toBlock: 6_000,
      pools: ['WBTC-Short'],
      provider: makeStubProvider(),
    });
    const [position] = report.positions;
    expect(position.positionId).to.equal(CLOSED_ID);
    expect(position.custodyStatus).to.equal('held');
    expect(position.isEmpty).to.equal(true);
    expect(position.side).to.equal('short');
  });

  it('classifies a token owned by address(0) as burned', async () => {
    const report = await rediscoverFxPositions({
      accounts: [EXEC_A],
      fromBlock: 6_001,
      toBlock: 6_002,
      pools: ['WBTC-Short'],
      provider: makeStubProvider(),
    });
    const burned = report.positions.find(p => p.positionId === BURNED_ID);
    expect(burned?.custodyStatus).to.equal('burned');
  });
});

describe('f(x) rediscovery — never map a read error to zero', () => {
  it('records a failed confirming read as unreadable, not as burned or closed', async () => {
    // `ownerOf` genuinely reverts for a nonexistent id, so the temptation is to
    // read a revert as "the position went away". This id came out of a Transfer
    // log emitted by this very contract, so it cannot have.
    const report = await rediscoverFxPositions({
      accounts: [EXEC_A],
      fromBlock: 6_003,
      toBlock: 6_003,
      pools: ['WBTC-Short'],
      provider: makeStubProvider(),
    });
    expect(report.complete).to.equal(false);
    expect(report.unreadableCount).to.equal(1);
    expect(report.unreadable[0].positionId).to.equal(UNREADABLE_ID);
    expect(report.positions).to.deep.equal([]);
    expect(() => assertFxRediscoveryComplete(report)).to.throw(/LOWER BOUND/);
  });

  it('records a failed pool query as unscanned and keeps scanning other pools', async () => {
    const report = await rediscoverFxPositions({
      accounts: [EXEC_A, EXEC_B],
      fromBlock: 0,
      toBlock: 5_999,
      provider: makeStubProvider({
        failLogsForPool: new Set([WSTETH_LONG.address]),
      }),
    });
    expect(report.complete).to.equal(false);
    expect(report.unscannedCount).to.equal(1);
    expect(report.unscanned[0].pool).to.equal(WSTETH_LONG.address);
    // The other three pools were still scanned.
    expect(report.pools.length).to.equal(KNOWN_POOLS.length);
    expect(() => assertFxRediscoveryComplete(report)).to.throw(
      /1 unscanned range/,
    );
  });

  it('pins both confirming reads to the scan toBlock', async () => {
    const blockTags: (number | string | undefined)[] = [];
    await rediscoverFxPositions({
      accounts: [EXEC_B],
      fromBlock: 0,
      toBlock: 15_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider({ blockTags, head: 20_000 }),
    });
    // EXEC_B touched two tokens on this pool (the one it still holds and the one
    // it handed off), and each costs ownerOf + getPosition.
    expect(blockTags.length).to.equal(4);
    for (const tag of blockTags) {
      expect(tag).to.equal(15_000);
    }
  });

  it('returns the report unchanged when nothing went unread', async () => {
    const report = await rediscoverFxPositions({
      accounts: [EXEC_B],
      fromBlock: 0,
      toBlock: 20_000,
      pools: ['wstETH-Long'],
      provider: makeStubProvider(),
    });
    expect(assertFxRediscoveryComplete(report)).to.equal(report);
  });
});
