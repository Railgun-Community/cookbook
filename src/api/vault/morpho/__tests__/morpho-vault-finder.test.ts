import chai from 'chai';
import { Interface, ZeroAddress, getAddress, type Filter, type Provider } from 'ethers';
import {
  MORPHO_VAULT_V2_GATE_ABI,
  type MorphoVaultV2GateName,
} from '../../../../contract/vault/morpho/metamorpho-vault-contract';
import {
  CREATE_METAMORPHO_INTERFACE,
  CREATE_VAULT_V2_INTERFACE,
  MORPHO_VAULT_FACTORIES,
  type MorphoVaultGeneration,
} from '../morpho-vault-discovery';
import {
  MORPHO_VAULT_SEEDS,
  findMorphoVaults,
  morphoVaultSeedsForAsset,
} from '../morpho-vault-finder';

const { expect } = chai;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret
/**
 * A REAL 18-decimal token that answers `symbol() == "USDC"`, holding position
 * among the 115 distinct assets the live vaults use. Three separate addresses
 * claim that ticker on mainnet; this is one of the two impostors.
 */
const DECOY_USDC = '0x59D5c6f5fdf8FA53c6Fe44BB053B41AB1EAAAa23'; // pragma: allowlist secret

/** adpUSDC — largest shieldable USDC vault measured (118.1M). */
const BIG_V1_VAULT = '0x55555815a5595991C3A0Ff119B59AEF6C8B55555'; // pragma: allowlist secret
/** Steakhouse Prime USDC — ungated Vault V2 (106.7M). */
const V2_VAULT = '0xbeef088055857739C12CD3765F20b7679Def0f51'; // pragma: allowlist secret
/** A real share-gated USDC Vault V2, with the gates it actually reports. */
const SHARE_GATED_VAULT = '0x30cACd22F178C9E57b0b010e1f9432881aa530C4'; // pragma: allowlist secret
const RECEIVE_SHARES_GATE = '0x5351999cA54675607d08003d9113553162bB795D'; // pragma: allowlist secret
const SEND_SHARES_GATE = '0x02B38131Bd473554D2CEd77018c18d030C7CE390'; // pragma: allowlist secret
/** The real vault whose asset is the 18-decimal decoy USDC. */
const DECOY_VAULT = '0x229b34e68F00422E596c8c6f59E8E630BaF6Bc83'; // pragma: allowlist secret

const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'; // pragma: allowlist secret

const HEAD = 25_689_048;

const gateIface = new Interface(MORPHO_VAULT_V2_GATE_ABI);
const registryIface = new Interface([
  'function isMetaMorpho(address) view returns (bool)',
  'function isVaultV2(address) view returns (bool)',
]);
const stateIface = new Interface([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
]);

const selectorOf = (name: 'asset' | 'totalAssets'): string => {
  const fragment = stateIface.getFunction(name);
  if (fragment === null) {
    throw new Error(`missing fragment ${name}`);
  }
  return fragment.selector;
};
const assetSelector = selectorOf('asset');
const totalAssetsSelector = selectorOf('totalAssets');

type VaultFixture = {
  generation: MorphoVaultGeneration;
  /** Live `asset()`. Deliberately allowed to differ from the creation log. */
  asset: string;
  totalAssets?: bigint | 'revert' | 'network';
  gates?: Partial<Record<MorphoVaultV2GateName, string>>;
  /** Emit a creation log for this vault (i.e. it is enumerable). */
  inLogs?: boolean;
  /** Asset recorded in the creation log, if not `asset`. */
  logAsset?: string;
};

const revertError = (): Error =>
  Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
const networkError = (): Error =>
  Object.assign(new Error('connection refused'), { code: 'NETWORK_ERROR' });

const factoryFor = (generation: MorphoVaultGeneration) => {
  const factory = MORPHO_VAULT_FACTORIES.find(
    entry => entry.generation === generation,
  );
  if (factory === undefined) {
    throw new Error(`no factory for generation ${generation}`);
  }
  return factory;
};

/** Build the exact log shape each factory emits, via the shipped Interfaces. */
const creationLog = (vault: string, fixture: VaultFixture) => {
  const factory = factoryFor(fixture.generation);
  const asset = fixture.logAsset ?? fixture.asset;
  const salt = `0x${'11'.repeat(32)}`;
  const encoded =
    fixture.generation === 'vault-v2'
      ? CREATE_VAULT_V2_INTERFACE.encodeEventLog('CreateVaultV2', [
          EXECUTOR,
          asset,
          salt,
          vault,
        ])
      : CREATE_METAMORPHO_INTERFACE.encodeEventLog('CreateMetaMorpho', [
          vault,
          EXECUTOR,
          EXECUTOR,
          86_400n,
          asset,
          'Test Vault',
          'TV',
          salt,
        ]);
  return {
    address: factory.address,
    blockNumber: factory.firstVaultBlock + 1,
    topics: encoded.topics,
    data: encoded.data,
  };
};

const makeProvider = (
  vaults: Record<string, VaultFixture>,
  options?: { failGetLogs?: boolean },
): { provider: Provider; filters: Filter[] } => {
  const filters: Filter[] = [];
  const byAddress = new Map(
    Object.entries(vaults).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const logs = Object.entries(vaults)
    .filter(([, fixture]) => fixture.inLogs === true)
    .map(([vault, fixture]) => creationLog(getAddress(vault), fixture));

  const call = async (tx: { to?: unknown; data?: unknown }): Promise<string> => {
    const to = String(tx.to);
    const data = String(tx.data);

    const factory = MORPHO_VAULT_FACTORIES.find(
      entry => entry.address.toLowerCase() === to.toLowerCase(),
    );
    if (factory !== undefined) {
      const queried = registryIface.decodeFunctionData(
        factory.registryFunction,
        data,
      )[0] as string;
      const fixture = byAddress.get(queried.toLowerCase());
      return registryIface.encodeFunctionResult(factory.registryFunction, [
        fixture !== undefined && fixture.generation === factory.generation,
      ]);
    }

    const fixture = byAddress.get(to.toLowerCase());
    if (fixture === undefined) {
      throw revertError();
    }

    if (data.startsWith(assetSelector)) {
      return stateIface.encodeFunctionResult('asset', [fixture.asset]);
    }
    if (data.startsWith(totalAssetsSelector)) {
      const value = fixture.totalAssets ?? 1_000_000n;
      if (value === 'revert') {
        throw revertError();
      }
      if (value === 'network') {
        throw networkError();
      }
      return stateIface.encodeFunctionResult('totalAssets', [value]);
    }

    const gateFn = MORPHO_VAULT_V2_GATE_ABI.map(entry => entry.name).find(
      name => gateIface.getFunction(name)?.selector === data.slice(0, 10),
    );
    if (gateFn !== undefined) {
      // A V1 MetaMorpho vault has no gate mechanism: every getter reverts.
      if (fixture.generation !== 'vault-v2') {
        throw revertError();
      }
      if (gateFn.endsWith('Gate')) {
        return gateIface.encodeFunctionResult(gateFn, [
          fixture.gates?.[gateFn as MorphoVaultV2GateName] ?? ZeroAddress,
        ]);
      }
      return gateIface.encodeFunctionResult(gateFn, [true]);
    }
    throw new Error(`unexpected call to ${to}: ${data}`);
  };

  const provider = {
    call,
    getBlockNumber: async () => HEAD,
    getLogs: async (filter: Filter) => {
      filters.push(filter);
      if (options?.failGetLogs === true) {
        throw new Error('403: eth_getLogs requires an archive token');
      }
      const from = Number(filter.fromBlock);
      const to = Number(filter.toBlock);
      const address = String(filter.address).toLowerCase();
      const topics = (filter.topics ?? []) as (string | null)[];
      return logs.filter(
        log =>
          log.blockNumber >= from &&
          log.blockNumber <= to &&
          log.address.toLowerCase() === address &&
          topics.every(
            (expected, index) =>
              expected === null ||
              expected === undefined ||
              expected.toLowerCase() === log.topics[index]?.toLowerCase(),
          ),
      );
    },
  } as unknown as Provider;

  return { provider, filters };
};

const addresses = (list: readonly { vaultAddress: string }[]): string[] =>
  list.map(entry => entry.vaultAddress);

describe('morpho-vault-finder', () => {
  describe('MORPHO_VAULT_SEEDS', () => {
    it('Should hold checksummed, unique vault addresses', () => {
      const seen = new Set<string>();
      for (const seed of MORPHO_VAULT_SEEDS) {
        expect(getAddress(seed.vaultAddress)).to.equal(seed.vaultAddress);
        expect(getAddress(seed.assetAddress)).to.equal(seed.assetAddress);
        expect(seen.has(seed.vaultAddress.toLowerCase())).to.equal(false);
        seen.add(seed.vaultAddress.toLowerCase());
      }
      expect(seen.size).to.equal(MORPHO_VAULT_SEEDS.length);
    });

    it('Should carry no mutable state — only address, asset and generation', () => {
      // A snapshot of gates or TVL would rot silently and dangerously: a V2
      // curator can attach a share gate at any block. Everything a routing
      // decision depends on must be read live, so it must not be storable here.
      for (const seed of MORPHO_VAULT_SEEDS) {
        expect(Object.keys(seed).sort()).to.deep.equal([
          'assetAddress',
          'assetSymbol',
          'generation',
          'label',
          'vaultAddress',
        ]);
      }
    });

    it('Should pin every USDC seed to the CANONICAL USDC, not an impostor', () => {
      // Three mainnet addresses answer symbol() == "USDC" and one of them has
      // 18 decimals. A seed table addressed by ticker would be a live footgun.
      const usdcSeeds = MORPHO_VAULT_SEEDS.filter(
        seed => seed.assetSymbol === 'USDC',
      );
      expect(usdcSeeds.length).to.be.greaterThan(0);
      usdcSeeds.forEach(seed =>
        expect(seed.assetAddress).to.equal(USDC),
      );
      expect(
        MORPHO_VAULT_SEEDS.some(seed => seed.assetAddress === DECOY_USDC),
      ).to.equal(false);
    });

    it('Should improve materially on the two shipped KNOWN_* entries', () => {
      // The complaint this module answers: the curated registry carried one
      // vault per generation. Both are still here; there are simply more.
      const held = new Set(
        MORPHO_VAULT_SEEDS.map(seed => seed.vaultAddress.toLowerCase()),
      );
      expect(held.has('0xbeef01735c132ada46aa9aa4c54623caa92a64cb')).to.equal(
        true,
      );
      expect(held.has('0xbeef088055857739c12cd3765f20b7679def0f51')).to.equal(
        true,
      );
      expect(new Set(MORPHO_VAULT_SEEDS.map(s => s.assetAddress)).size).to.be.at
        .least(6);
    });

    it('Should resolve seeds by asset, case-insensitively', () => {
      expect(morphoVaultSeedsForAsset(USDC.toLowerCase()).length).to.equal(
        morphoVaultSeedsForAsset(USDC).length,
      );
      expect(morphoVaultSeedsForAsset(USDC).length).to.be.greaterThan(1);
      expect(morphoVaultSeedsForAsset(DECOY_USDC)).to.deep.equal([]);
    });
  });

  describe('findMorphoVaults', () => {
    it('Should rank shieldable vaults by size, largest first', async () => {
      const { provider } = makeProvider({
        [BIG_V1_VAULT]: {
          generation: 'metamorpho-v1.1',
          asset: USDC,
          totalAssets: 118_107_993_000_000n,
          inLogs: true,
        },
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 106_689_182_000_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
      });

      expect(found.complete).to.equal(true);
      expect(addresses(found.shieldable)).to.deep.equal([
        BIG_V1_VAULT,
        V2_VAULT,
      ]);
      expect(found.blocked).to.deep.equal([]);
      expect(found.enumeration.attempted).to.equal(true);
      expect(found.enumeration.complete).to.equal(true);
    });

    it('Should REJECT a share-gated vault instead of ranking it', async () => {
      // The load-bearing rule. This vault quotes fine and holds real money —
      // depositing succeeds and the shares are then unshieldable, so it must
      // never appear in `shieldable` however attractive its size.
      const { provider } = makeProvider({
        [SHARE_GATED_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          // Larger than the healthy one, so a size-only ranking would put it first.
          totalAssets: 999_999_999_000_000n,
          gates: {
            receiveSharesGate: RECEIVE_SHARES_GATE,
            sendSharesGate: SEND_SHARES_GATE,
          },
          inLogs: true,
        },
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 1_000_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        account: EXECUTOR,
        useCuratedSeeds: false,
      });

      expect(addresses(found.shieldable)).to.deep.equal([V2_VAULT]);
      expect(addresses(found.blocked)).to.deep.equal([SHARE_GATED_VAULT]);
      expect(
        found.blocked[0].screening.blockers.map(blocker => blocker.code),
      ).to.contain('share-gate');
      // Still complete: the gate was READ successfully, it just says no.
      expect(found.complete).to.equal(true);
    });

    it('Should block a vault whose live asset is a same-ticker impostor', async () => {
      // The vault is real and registered; its asset merely is not the one asked
      // for. Without the cross-check this deposits the wrong token — and the
      // decoy has 18 decimals against USDC's 6, so the amount math is wrong too.
      const { provider } = makeProvider({
        [DECOY_VAULT]: {
          generation: 'vault-v2',
          asset: DECOY_USDC,
          logAsset: USDC,
          totalAssets: 1_000_000_000_000_000_000_000_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
      });

      expect(found.shieldable).to.deep.equal([]);
      expect(addresses(found.blocked)).to.deep.equal([DECOY_VAULT]);
      expect(
        found.blocked[0].screening.blockers.map(blocker => blocker.code),
      ).to.contain('asset-mismatch');
    });

    it('Should keep seeds usable when eth_getLogs is refused, but NOT claim completeness', async () => {
      // The keyless-RPC case, which is the DEFAULT on public endpoints. The
      // caller must still get something routable, and must still be able to
      // tell that enumeration never happened.
      const { provider } = makeProvider(
        {
          [V2_VAULT]: {
            generation: 'vault-v2',
            asset: USDC,
            totalAssets: 106_689_182_000_000n,
          },
          [BIG_V1_VAULT]: {
            generation: 'metamorpho-v1.1',
            asset: USDC,
            totalAssets: 118_107_993_000_000n,
          },
        },
        { failGetLogs: true },
      );
      const found = await findMorphoVaults({ provider, asset: USDC });

      expect(found.shieldable.length).to.be.greaterThan(0);
      // Every one came from the curated list, and says so.
      found.shieldable.forEach(candidate => {
        expect(candidate.curated).to.equal(true);
        expect(candidate.enumerated).to.equal(false);
      });
      expect(found.complete).to.equal(false);
      expect(found.enumeration.attempted).to.equal(true);
      expect(found.enumeration.complete).to.equal(false);
      expect(found.enumeration.unscanned.length).to.be.greaterThan(0);
    });

    it('Should never report complete when enumeration was not attempted', async () => {
      const { provider, filters } = makeProvider({
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 106_689_182_000_000n,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        enumerate: false,
      });

      expect(filters).to.deep.equal([]);
      expect(found.enumeration.attempted).to.equal(false);
      expect(found.complete).to.equal(false);
      // Seeds still screened, so the answer is useful — just not exhaustive.
      expect(found.shieldable.length).to.be.greaterThan(0);
    });

    it('Should merge a vault found BOTH ways into one candidate', async () => {
      const { provider } = makeProvider({
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 106_689_182_000_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({ provider, asset: USDC });

      const merged = found.candidates.filter(
        candidate =>
          candidate.vaultAddress.toLowerCase() === V2_VAULT.toLowerCase(),
      );
      expect(merged).to.have.length(1);
      expect(merged[0].enumerated).to.equal(true);
      expect(merged[0].curated).to.equal(true);
      expect(merged[0].discovered?.generation).to.equal('vault-v2');
      expect(merged[0].seed?.assetSymbol).to.equal('USDC');
    });

    it('Should put a healthy-but-small vault in belowMinimum, not in blocked or unreadable', async () => {
      // A size preference is not a safety verdict. Folding it into either of
      // the other buckets would make "too small for me" indistinguishable from
      // "will strand your shares" or "could not be read".
      const { provider } = makeProvider({
        [BIG_V1_VAULT]: {
          generation: 'metamorpho-v1.1',
          asset: USDC,
          totalAssets: 500_000_000n,
          inLogs: true,
        },
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 1_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
        minTotalAssets: 1_000_000n,
      });

      expect(addresses(found.shieldable)).to.deep.equal([BIG_V1_VAULT]);
      expect(addresses(found.belowMinimum)).to.deep.equal([V2_VAULT]);
      expect(found.blocked).to.deep.equal([]);
      expect(found.unreadable).to.deep.equal([]);
      expect(found.belowMinimum[0].screening.ok).to.equal(true);
      // A small vault is not a broken one, so the answer is still complete.
      expect(found.complete).to.equal(true);
    });

    it('Should not treat an unreadable totalAssets as zero when ranking', async () => {
      // §9 applied to ordering: an unread balance must not sort as empty, and
      // the vault must not be presented as usable.
      const { provider } = makeProvider({
        [BIG_V1_VAULT]: {
          generation: 'metamorpho-v1.1',
          asset: USDC,
          totalAssets: 'network',
          inLogs: true,
        },
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 1_000n,
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
      });

      expect(addresses(found.shieldable)).to.deep.equal([V2_VAULT]);
      expect(addresses(found.unreadable)).to.deep.equal([BIG_V1_VAULT]);
      expect(found.unreadable[0].screening.totalAssets).to.equal(undefined);
      expect(found.complete).to.equal(false);
    });

    it('Should sort a GENUINELY empty vault ahead of one whose size is unknown', async () => {
      // The comparator itself, isolated. Both vaults below are blocked, so they
      // share a bucket and their relative order is decided by the comparator
      // rather than by which list they landed in.
      //
      // `0xbeef…` holds a real, read 0; `0x229b…` reverts on totalAssets, so its
      // size is UNKNOWN. Treating unknown as zero makes these tie, and the
      // address tiebreak then puts `0x229b…` first. Ranking unknown last keeps
      // `0xbeef…` first — the assertion only holds under the correct rule.
      const { provider } = makeProvider({
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 0n,
          gates: {
            receiveSharesGate: RECEIVE_SHARES_GATE,
            sendSharesGate: SEND_SHARES_GATE,
          },
          inLogs: true,
        },
        [DECOY_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 'revert',
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
      });

      expect(V2_VAULT.localeCompare(DECOY_VAULT)).to.be.greaterThan(0);
      expect(found.blocked[0].screening.totalAssets).to.equal(0n);
      expect(found.blocked[1].screening.totalAssets).to.equal(undefined);
      expect(addresses(found.blocked)).to.deep.equal([V2_VAULT, DECOY_VAULT]);
    });

    it('Should distinguish an unquotable vault from an unreachable one', async () => {
      const { provider } = makeProvider({
        [V2_VAULT]: {
          generation: 'vault-v2',
          asset: USDC,
          totalAssets: 'revert',
          inLogs: true,
        },
      });
      const found = await findMorphoVaults({
        provider,
        asset: USDC,
        useCuratedSeeds: false,
      });

      expect(addresses(found.blocked)).to.deep.equal([V2_VAULT]);
      expect(
        found.blocked[0].screening.blockers.map(blocker => blocker.code),
      ).to.contain('unquotable');
      expect(found.unreadable).to.deep.equal([]);
    });

    it('Should return an empty, COMPLETE answer for an asset with no vaults', async () => {
      // The one case where "none exists" is an honest thing to say.
      const { provider } = makeProvider({});
      const found = await findMorphoVaults({ provider, asset: WETH, enumerate: true, useCuratedSeeds: false });

      expect(found.candidates).to.deep.equal([]);
      expect(found.shieldable).to.deep.equal([]);
      expect(found.complete).to.equal(true);
      expect(found.enumeration.complete).to.equal(true);
    });

    it('Should reject a bad concurrency rather than silently serialising', async () => {
      const { provider } = makeProvider({});
      let threw = false;
      try {
        await findMorphoVaults({ provider, asset: USDC, concurrency: 0 });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });
});
