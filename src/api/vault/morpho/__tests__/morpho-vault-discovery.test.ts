import chai from 'chai';
import { type Filter, type Provider, zeroPadValue } from 'ethers';
import {
  CREATE_METAMORPHO_TOPIC0,
  CREATE_VAULT_V2_TOPIC0,
  MORPHO_VAULT_FACTORIES,
  decodeMorphoVaultCreationLog,
  filterMorphoVaults,
  morphoVaultFactoryForAddress,
  scanMorphoVaults,
  type MorphoVaultFactory,
  type MorphoVaultScan,
} from '../morpho-vault-discovery';

const { expect } = chai;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'; // pragma: allowlist secret

const FACTORY_V1_0 = '0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101'; // pragma: allowlist secret
const FACTORY_V1_1 = '0x1897A8997241C1cD4bD0698647e4EB7213535c24'; // pragma: allowlist secret
const FACTORY_V2 = '0xA1D94F746dEfa1928926b84fB2596c06926C0405'; // pragma: allowlist secret

const HEAD = 25_688_692;

/**
 * Real creation logs, captured from the three deployed factories at the blocks
 * named. Recorded rather than fetched live because the common public endpoints
 * refuse `eth_getLogs` (publicnode answers 403, ankr requires a key), which
 * would make this a test of RPC entitlements instead of the decoder. These bytes
 * are what mainnet actually emitted; a stub provider replays them under real
 * topic-filter semantics.
 */
type RecordedLog = {
  blockNumber: number;
  topics: string[];
  data: string;
  address: string;
};

/** Steakhouse USDC — the vault the shipped `KNOWN_METAMORPHO_VAULTS` entry names. */
const LOG_STEAKHOUSE_USDC: RecordedLog = {
  blockNumber: 18_928_285,
  address: FACTORY_V1_0,
  topics: [
    '0xed8c95d05909b0f217f3e68171ef917df4b278d5addfe4dda888e90279be7d1d',
    '0x000000000000000000000000beef01735c132ada46aa9aa4c54623caa92a64cb',
    '0x000000000000000000000000255c7705e8bb334dfcae438197f7c4297988085a',
    '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ],
  data:
    '0x000000000000000000000000255c7705e8bb334dfcae438197f7c4297988085a' +
    '0000000000000000000000000000000000000000000000000000000000015180' +
    '00000000000000000000000000000000000000000000000000000000000000a0' +
    '00000000000000000000000000000000000000000000000000000000000000e0' +
    'df3721aabb9653d1272b9645135353bd2fddca56627bd73e7f5020b30438a003' +
    '000000000000000000000000000000000000000000000000000000000000000f' +
    '537465616b686f75736520555344430000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    '737465616b555344430000000000000000000000000000000000000000000000',
};

/** Steakhouse PAXG — the FIRST vault the v1.1 factory ever created. */
const LOG_STEAKHOUSE_PAXG: RecordedLog = {
  blockNumber: 21_450_663,
  address: FACTORY_V1_1,
  topics: [
    '0xed8c95d05909b0f217f3e68171ef917df4b278d5addfe4dda888e90279be7d1d',
    '0x000000000000000000000000beef7959ae71d4e45e1863dae0b94c35244af816',
    '0x0000000000000000000000000a0e559bc3b0950a7e448f0d4894db195b9cf8dd',
    '0x00000000000000000000000045804880de22913dafe09f4980848ece6ecbaf78',
  ],
  data:
    '0x0000000000000000000000000a0e559bc3b0950a7e448f0d4894db195b9cf8dd' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '00000000000000000000000000000000000000000000000000000000000000a0' +
    '00000000000000000000000000000000000000000000000000000000000000e0' +
    '8b9bedb2889cf5e95e00cdfc8aea5cded931b662a0867ea1f41ca5f7ee3810a5' +
    '000000000000000000000000000000000000000000000000000000000000000f' +
    '537465616b686f75736520504158470000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    '737465616b504158470000000000000000000000000000000000000000000000',
};

/** Steakhouse Prime USDC — the shipped `KNOWN_MORPHO_VAULTS_V2` entry. */
const LOG_STEAKHOUSE_PRIME_USDC: RecordedLog = {
  blockNumber: 23_671_611,
  address: FACTORY_V2,
  topics: [
    '0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e',
    '0x0000000000000000000000007e17ec774becd5f4f129fa5f150046dd0ece5bb0',
    '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0x000000000000000000000000beef088055857739c12cd3765f20b7679def0f51',
  ],
  data: '0x4d4e49bc0a952a3d894e32e1553e1f0594caf959dd7da75ea5d82b35f4be3a01',
};

/**
 * A live SHARE-GATED USDC Vault V2. Measured: `receiveSharesGate` is
 * `0x5351999c…` and `sendSharesGate` is `0x02B38131…`, which makes its shares
 * unshieldable — see `morpho-vault-screening.ts`. It exists here to make the
 * point that discovery by asset alone routes straight into one of these: 24 of
 * the 357 USDC Vault V2 vaults are share-gated.
 */
const LOG_SHARE_GATED_USDC: RecordedLog = {
  blockNumber: 23_546_919,
  address: FACTORY_V2,
  topics: [
    '0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e',
    '0x0000000000000000000000006a85d9e2fec21f9c9452fc4022abf2a21a462851',
    '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0x00000000000000000000000030cacd22f178c9e57b0b010e1f9432881aa530c4',
  ],
  data: '0x59a174f4bbaeb5ddd90539a001a1968ca9dd92215e81914ad4d2dfa5a07c5f72',
};

const ALL_LOGS = [
  LOG_STEAKHOUSE_USDC,
  LOG_STEAKHOUSE_PAXG,
  LOG_SHARE_GATED_USDC,
  LOG_STEAKHOUSE_PRIME_USDC,
];

/**
 * Stub provider implementing REAL `eth_getLogs` topic semantics — a filter entry
 * must match at its OWN position, positions AND together, and `null` matches
 * anything. Without that, an asset filter at the wrong topic index would still
 * "pass" and the trap this module exists to avoid would be untested.
 */
const stubProvider = (options?: {
  logs?: RecordedLog[];
  failGetLogs?: boolean;
  failBlockNumber?: boolean;
}): { provider: Provider; filters: Filter[] } => {
  const logs = options?.logs ?? ALL_LOGS;
  const filters: Filter[] = [];

  const matchesTopic = (
    expected: string | string[] | null | undefined,
    actual: string | undefined,
  ): boolean => {
    if (expected === null || expected === undefined) {
      return true;
    }
    if (actual === undefined) {
      return false;
    }
    const wanted = Array.isArray(expected) ? expected : [expected];
    return wanted.some(
      topic => topic.toLowerCase() === actual.toLowerCase(),
    );
  };

  const provider = {
    getBlockNumber: async () => {
      if (options?.failBlockNumber === true) {
        throw new Error('connection refused');
      }
      return HEAD;
    },
    getLogs: async (filter: Filter) => {
      filters.push(filter);
      if (options?.failGetLogs === true) {
        throw new Error('403: eth_getLogs is not supported by this endpoint');
      }
      const from = Number(filter.fromBlock);
      const to = Number(filter.toBlock);
      const address = String(filter.address).toLowerCase();
      const topics = (filter.topics ?? []) as (string | string[] | null)[];
      return logs.filter(
        log =>
          log.blockNumber >= from &&
          log.blockNumber <= to &&
          log.address.toLowerCase() === address &&
          topics.every((expected, index) =>
            matchesTopic(expected, log.topics[index]),
          ),
      );
    },
  } as unknown as Provider;

  return { provider, filters };
};

describe('morpho-vault-discovery', () => {
  describe('event fragments', () => {
    it('Should compute the topic0s that mainnet actually emits', () => {
      // Taken from the recorded logs above. A mismatch here means a signature
      // drifted and every scan below is silently empty — which is exactly how
      // this kind of bug ships unnoticed.
      expect(CREATE_METAMORPHO_TOPIC0).to.equal(
        '0xed8c95d05909b0f217f3e68171ef917df4b278d5addfe4dda888e90279be7d1d',
      );
      expect(CREATE_VAULT_V2_TOPIC0).to.equal(
        '0x341ce009267aa0d78cc12b34155e223904a51ed49d144beb6eb8be87813edb4e',
      );
      expect(CREATE_METAMORPHO_TOPIC0).to.not.equal(CREATE_VAULT_V2_TOPIC0);
    });

    it('Should declare the topic layout each factory actually uses', () => {
      // The whole cost story of this module. If these ever converge, the
      // asset-filter tests below stop finding half the population.
      const [v1_0, v1_1, v2] = MORPHO_VAULT_FACTORIES;
      expect(v1_0.vaultTopicIndex).to.equal(1);
      expect(v1_0.assetTopicIndex).to.equal(3);
      expect(v1_1.vaultTopicIndex).to.equal(1);
      expect(v1_1.assetTopicIndex).to.equal(3);
      expect(v2.vaultTopicIndex).to.equal(3);
      expect(v2.assetTopicIndex).to.equal(2);
    });
  });

  describe('decodeMorphoVaultCreationLog', () => {
    const v1_0 = MORPHO_VAULT_FACTORIES[0];
    const v1_1 = MORPHO_VAULT_FACTORIES[1];
    const v2 = MORPHO_VAULT_FACTORIES[2];

    it('Should decode the exact bytes the v1.0 factory emitted', () => {
      const vault = decodeMorphoVaultCreationLog(LOG_STEAKHOUSE_USDC, v1_0);
      expect(vault).to.not.equal(undefined);
      expect(vault?.vaultAddress).to.equal(
        '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
      );
      expect(vault?.assetAddress).to.equal(USDC);
      expect(vault?.name).to.equal('Steakhouse USDC');
      expect(vault?.symbol).to.equal('steakUSDC');
      expect(vault?.initialTimelock).to.equal(86_400n);
      expect(vault?.generation).to.equal('metamorpho-v1');
      // V1 has no gate mechanism in its bytecode, so its shares are always
      // shieldable — no state read needed to know that.
      expect(vault?.canBeGated).to.equal(false);
    });

    it('Should decode the exact bytes the v1.1 factory emitted', () => {
      const vault = decodeMorphoVaultCreationLog(LOG_STEAKHOUSE_PAXG, v1_1);
      expect(vault?.vaultAddress).to.equal(
        '0xBeeF7959aE71D4e45e1863dae0B94C35244AF816',
      );
      expect(vault?.assetAddress).to.equal(PAXG);
      expect(vault?.name).to.equal('Steakhouse PAXG');
      expect(vault?.generation).to.equal('metamorpho-v1.1');
      expect(vault?.canBeGated).to.equal(false);
    });

    it('Should decode the exact bytes the Vault V2 factory emitted', () => {
      const vault = decodeMorphoVaultCreationLog(
        LOG_STEAKHOUSE_PRIME_USDC,
        v2,
      );
      // The vault address is at topic3 here and the asset at topic2 — the
      // opposite of the MetaMorpho layout.
      expect(vault?.vaultAddress).to.equal(
        '0xbeef088055857739C12CD3765F20b7679Def0f51',
      );
      expect(vault?.assetAddress).to.equal(USDC);
      expect(vault?.generation).to.equal('vault-v2');
      expect(vault?.canBeGated).to.equal(true);
      // V2's creation event carries no name/symbol at all.
      expect(vault?.name).to.equal(undefined);
      expect(vault?.symbol).to.equal(undefined);
      expect(vault?.salt).to.equal(
        '0x4d4e49bc0a952a3d894e32e1553e1f0594caf959dd7da75ea5d82b35f4be3a01',
      );
    });

    it('Should read the WRONG asset if the topic indices are unified', () => {
      // The trap, made explicit against real bytes. Applying the MetaMorpho
      // layout (asset at topic3) to a real CreateVaultV2 log reads the VAULT
      // address as the asset. Nothing throws; the answer is just wrong.
      const wrongLayout: MorphoVaultFactory = { ...v2, assetTopicIndex: 3 };
      const misread = decodeMorphoVaultCreationLog(
        LOG_STEAKHOUSE_PRIME_USDC,
        wrongLayout,
      );
      expect(misread?.assetAddress).to.not.equal(USDC);
      expect(misread?.assetAddress).to.equal(
        '0xbeef088055857739C12CD3765F20b7679Def0f51',
      );
    });

    it('Should refuse a log whose topic0 belongs to the other factory family', () => {
      expect(decodeMorphoVaultCreationLog(LOG_STEAKHOUSE_PRIME_USDC, v1_0)).to.equal(
        undefined,
      );
      expect(decodeMorphoVaultCreationLog(LOG_STEAKHOUSE_USDC, v2)).to.equal(
        undefined,
      );
    });

    it('Should refuse a truncated log rather than decoding garbage', () => {
      expect(
        decodeMorphoVaultCreationLog(
          { ...LOG_STEAKHOUSE_USDC, topics: LOG_STEAKHOUSE_USDC.topics.slice(0, 3) },
          v1_0,
        ),
      ).to.equal(undefined);
      expect(
        decodeMorphoVaultCreationLog(
          { ...LOG_STEAKHOUSE_USDC, data: '0x1234' },
          v1_0,
        ),
      ).to.equal(undefined);
    });
  });

  describe('scanMorphoVaults', () => {
    it('Should enumerate every factory by default', async () => {
      const { provider } = stubProvider();
      const scan = await scanMorphoVaults({ provider, chunkSize: 1_000_000 });

      expect(scan.complete).to.equal(true);
      expect(scan.unscanned).to.deep.equal([]);
      expect(scan.vaults).to.have.length(4);
      expect(scan.vaults.map(vault => vault.generation)).to.deep.equal([
        // Sorted by creation block.
        'metamorpho-v1',
        'metamorpho-v1.1',
        'vault-v2',
        'vault-v2',
      ]);
      expect(scan.factories).to.have.length(3);
    });

    it('Should push the asset filter to the node at the right index PER FACTORY', async () => {
      const { provider, filters } = stubProvider();
      await scanMorphoVaults({ provider, asset: USDC, chunkSize: 10_000_000 });

      const padded = zeroPadValue(USDC, 32).toLowerCase();
      const byFactory = (address: string) =>
        filters.filter(
          filter => String(filter.address).toLowerCase() === address.toLowerCase(),
        );

      for (const address of [FACTORY_V1_0, FACTORY_V1_1]) {
        const [filter] = byFactory(address);
        const topics = filter.topics as (string | null)[];
        expect(topics).to.have.length(4);
        expect(topics[1]).to.equal(null);
        expect(topics[2]).to.equal(null);
        expect(String(topics[3]).toLowerCase()).to.equal(padded);
      }

      const [v2Filter] = byFactory(FACTORY_V2);
      const v2Topics = v2Filter.topics as (string | null)[];
      // Asset at topic2, and topic3 left open — it holds the vault address.
      expect(v2Topics).to.have.length(3);
      expect(String(v2Topics[2]).toLowerCase()).to.equal(padded);
    });

    it('Should find USDC vaults on BOTH factory families with one asset filter', async () => {
      // This is the test that fails if the topic indices are ever unified:
      // pinning the asset at topic3 everywhere silently drops every Vault V2,
      // pinning it at topic2 everywhere silently drops every MetaMorpho.
      const { provider } = stubProvider();
      const scan = await scanMorphoVaults({
        provider,
        asset: USDC,
        chunkSize: 1_000_000,
      });

      expect(scan.complete).to.equal(true);
      const generations = new Set(scan.vaults.map(vault => vault.generation));
      expect(generations.has('metamorpho-v1')).to.equal(true);
      expect(generations.has('vault-v2')).to.equal(true);
      expect(scan.vaults).to.have.length(3);
      scan.vaults.forEach(vault =>
        expect(vault.assetAddress).to.equal(USDC),
      );
      // The PAXG vault is filtered out by the node, not locally.
      expect(
        scan.vaults.map(vault => vault.vaultAddress),
      ).to.not.contain('0xBeeF7959aE71D4e45e1863dae0B94C35244AF816');
    });

    it('Should start each factory at its own first-creation block', async () => {
      const { provider, filters } = stubProvider();
      await scanMorphoVaults({ provider, chunkSize: 100_000_000 });

      const starts = new Map(
        filters.map(filter => [
          String(filter.address).toLowerCase(),
          Number(filter.fromBlock),
        ]),
      );
      expect(starts.get(FACTORY_V1_0.toLowerCase())).to.equal(18_927_491);
      expect(starts.get(FACTORY_V1_1.toLowerCase())).to.equal(21_450_663);
      expect(starts.get(FACTORY_V2.toLowerCase())).to.equal(23_375_073);
    });

    it('Should clamp a too-early fromBlock up to each factory first block', async () => {
      const { provider, filters } = stubProvider();
      await scanMorphoVaults({
        provider,
        fromBlock: 1,
        chunkSize: 100_000_000,
      });
      // A factory cannot have emitted before its own first creation, so an
      // earlier start is wasted range, not extra coverage.
      filters.forEach(filter =>
        expect(Number(filter.fromBlock)).to.be.greaterThan(18_000_000),
      );
    });

    it('Should report failed ranges instead of returning an empty scan', async () => {
      // Not hypothetical: publicnode refuses eth_getLogs with a 403, so an
      // empty-and-incomplete scan is the NORMAL result on a keyless RPC.
      // "This asset has no Morpho vault" and "could not look" must stay
      // distinguishable or a caller tells the user their vault does not exist.
      const { provider } = stubProvider({ failGetLogs: true });
      const scan = await scanMorphoVaults({
        provider,
        asset: USDC,
        chunkSize: 10_000_000,
      });

      expect(scan.vaults).to.deep.equal([]);
      expect(scan.complete).to.equal(false);
      expect(scan.unscanned.length).to.be.greaterThan(0);
      expect(scan.unscanned[0].reason).to.match(/403|getLogs/);
      // Every factory is named, so a caller can re-scan exactly what was missed.
      expect(new Set(scan.unscanned.map(gap => gap.factoryAddress)).size).to.equal(
        3,
      );
    });

    it('Should report an unreadable head instead of scanning a bogus range', async () => {
      const { provider } = stubProvider({ failBlockNumber: true });
      const scan = await scanMorphoVaults({ provider });

      expect(scan.vaults).to.deep.equal([]);
      expect(scan.complete).to.equal(false);
      expect(scan.unscanned).to.have.length(3);
      expect(scan.unscanned[0].reason).to.match(/current block/);
    });

    it('Should record an undecodable log as a gap rather than dropping it', async () => {
      const corrupt: RecordedLog = { ...LOG_STEAKHOUSE_USDC, data: '0xdead' };
      const { provider } = stubProvider({ logs: [corrupt] });
      const scan = await scanMorphoVaults({ provider, chunkSize: 10_000_000 });

      expect(scan.vaults).to.deep.equal([]);
      expect(scan.complete).to.equal(false);
      expect(scan.unscanned[0].fromBlock).to.equal(18_928_285);
      expect(scan.unscanned[0].toBlock).to.equal(18_928_285);
    });

    it('Should restrict to a generation when asked', async () => {
      const { provider, filters } = stubProvider();
      const scan = await scanMorphoVaults({
        provider,
        generations: ['vault-v2'],
        chunkSize: 10_000_000,
      });

      expect(scan.factories).to.deep.equal([FACTORY_V2]);
      expect(filters.every(f => String(f.address) === FACTORY_V2)).to.equal(true);
      expect(scan.vaults).to.have.length(2);
    });

    it('Should reject a non-positive chunk size', async () => {
      const { provider } = stubProvider();
      let threw = false;
      try {
        await scanMorphoVaults({ provider, chunkSize: 0 });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });

  describe('morphoVaultFactoryForAddress', () => {
    it('Should resolve a factory case-insensitively', () => {
      expect(
        morphoVaultFactoryForAddress(FACTORY_V2.toLowerCase())?.generation,
      ).to.equal('vault-v2');
      expect(morphoVaultFactoryForAddress(USDC)).to.equal(undefined);
    });
  });

  describe('filterMorphoVaults', () => {
    let scan: MorphoVaultScan;

    before(async () => {
      const { provider } = stubProvider();
      scan = await scanMorphoVaults({ provider, chunkSize: 1_000_000 });
    });

    it('Should filter by asset, case-insensitively', () => {
      const found = filterMorphoVaults(scan, { asset: USDC.toLowerCase() });
      expect(found).to.have.length(3);
      found.forEach(vault => expect(vault.assetAddress).to.equal(USDC));
    });

    it('Should isolate the generation that can never be gated', () => {
      // The blunt, no-network answer to "will my shares be shieldable": a V1
      // vault has no gate mechanism in its bytecode, so yes, always.
      const ungatable = filterMorphoVaults(scan, { ungatableOnly: true });
      expect(ungatable).to.have.length(2);
      ungatable.forEach(vault => {
        expect(vault.canBeGated).to.equal(false);
        expect(vault.generation).to.not.equal('vault-v2');
      });
    });

    it('Should combine criteria conjunctively', () => {
      expect(
        filterMorphoVaults(scan, { asset: USDC, ungatableOnly: true }),
      ).to.have.length(1);
      expect(
        filterMorphoVaults(scan, {
          asset: USDC,
          generations: ['vault-v2'],
        }),
      ).to.have.length(2);
    });

    it('Should filter by creation block', () => {
      expect(
        filterMorphoVaults(scan, { createdOnOrAfterBlock: 23_000_000 }),
      ).to.have.length(2);
    });

    it('Should return everything when no criteria are given', () => {
      expect(filterMorphoVaults(scan, {})).to.have.length(4);
    });
  });
});
