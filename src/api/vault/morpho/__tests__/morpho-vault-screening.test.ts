import chai from 'chai';
import { Interface, type Provider, ZeroAddress } from 'ethers';
import {
  MORPHO_VAULT_V2_GATE_ABI,
  type MorphoVaultV2GateName,
} from '../../../../contract/vault/morpho/metamorpho-vault-contract';
import {
  MORPHO_VAULT_FACTORIES,
  type MorphoDiscoveredVault,
} from '../morpho-vault-discovery';
import {
  screenMorphoVault,
  screenMorphoVaults,
  verifyMorphoVaultFactoryRegistration,
} from '../morpho-vault-screening';

const { expect } = chai;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret

/** Steakhouse USDC — a real v1.0-factory MetaMorpho vault. */
const V1_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB'; // pragma: allowlist secret
/** Steakhouse Prime USDC — a real, ungated Vault V2. */
const V2_VAULT = '0xbeef088055857739C12CD3765F20b7679Def0f51'; // pragma: allowlist secret
/**
 * A real SHARE-GATED USDC Vault V2, with the gate addresses it actually
 * reports on mainnet. 24 of the 357 USDC Vault V2 vaults look like this.
 */
const SHARE_GATED_VAULT = '0x30cACd22F178C9E57b0b010e1f9432881aa530C4'; // pragma: allowlist secret
const RECEIVE_SHARES_GATE = '0x5351999cA54675607d08003d9113553162bB795D'; // pragma: allowlist secret
const SEND_SHARES_GATE = '0x02B38131Bd473554D2CEd77018c18d030C7CE390'; // pragma: allowlist secret
const SEND_ASSETS_GATE = '0x80dc268861Cf57D31c52E8cD0467B3d3024512bc'; // pragma: allowlist secret

const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'; // pragma: allowlist secret

const [FACTORY_V1_0, FACTORY_V1_1, FACTORY_V2] = MORPHO_VAULT_FACTORIES;

const gateIface = new Interface(MORPHO_VAULT_V2_GATE_ABI);
const registryIface = new Interface([
  'function isMetaMorpho(address) view returns (bool)',
  'function isVaultV2(address) view returns (bool)',
]);
const stateIface = new Interface([
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
]);

type GateCheckName =
  | 'canReceiveShares'
  | 'canSendShares'
  | 'canReceiveAssets'
  | 'canSendAssets';

/** `'revert'` = empty revert; `'network'` = a transport failure, not a revert. */
type Answer<T> = T | 'revert' | 'network';

type Fixture = {
  /** Which factory claims the vault. `undefined` = none of them does. */
  registeredBy?: 'metamorpho-v1' | 'metamorpho-v1.1' | 'vault-v2';
  /** Per-factory read overrides, keyed by factory address. */
  registryAnswers?: Record<string, Answer<boolean>>;
  asset?: Answer<string>;
  totalAssets?: Answer<bigint>;
  /** A whole gate absent means that getter reverts — what a V1 vault does. */
  gates?: Partial<Record<MorphoVaultV2GateName, Answer<string>>>;
  access?: Partial<Record<GateCheckName, Answer<boolean>>>;
  blockNumber?: Answer<number>;
};

const revertError = (): Error =>
  Object.assign(new Error('execution reverted'), {
    code: 'CALL_EXCEPTION',
    data: null,
  });

const networkError = (): Error =>
  Object.assign(new Error('connection refused'), { code: 'NETWORK_ERROR' });

const answer = <T>(value: Answer<T> | undefined, fallback: T): T => {
  if (value === 'revert') {
    throw revertError();
  }
  if (value === 'network') {
    throw networkError();
  }
  return value === undefined ? fallback : (value as T);
};

const makeProvider = (
  fixture: Fixture,
): { provider: Provider; calls: string[] } => {
  const calls: string[] = [];

  const call = async (tx: { to?: unknown; data?: unknown }): Promise<string> => {
    const to = String(tx.to);
    const data = String(tx.data);
    const factory = MORPHO_VAULT_FACTORIES.find(
      entry => entry.address.toLowerCase() === to.toLowerCase(),
    );

    if (factory !== undefined) {
      calls.push(`${factory.name}.${factory.registryFunction}`);
      const override = fixture.registryAnswers?.[factory.address];
      const claimed = answer(
        override,
        fixture.registeredBy === factory.generation,
      );
      return registryIface.encodeFunctionResult(factory.registryFunction, [
        claimed,
      ]);
    }

    if (data.startsWith(stateIface.getFunction('asset')?.selector ?? 'x')) {
      calls.push('asset');
      return stateIface.encodeFunctionResult('asset', [
        answer(fixture.asset, USDC),
      ]);
    }
    if (data.startsWith(stateIface.getFunction('totalAssets')?.selector ?? 'x')) {
      calls.push('totalAssets');
      return stateIface.encodeFunctionResult('totalAssets', [
        answer(fixture.totalAssets, 1_000_000n),
      ]);
    }

    const gateFn = MORPHO_VAULT_V2_GATE_ABI.map(f => f.name).find(
      name => gateIface.getFunction(name)?.selector === data.slice(0, 10),
    );
    if (gateFn !== undefined) {
      calls.push(gateFn);
      if (gateFn.endsWith('Gate')) {
        const gateAnswer = fixture.gates?.[gateFn as MorphoVaultV2GateName];
        if (gateAnswer === undefined) {
          // A V1 MetaMorpho vault: no gate mechanism, every getter reverts.
          throw revertError();
        }
        return gateIface.encodeFunctionResult(gateFn, [
          answer(gateAnswer, ZeroAddress),
        ]);
      }
      return gateIface.encodeFunctionResult(gateFn, [
        answer(fixture.access?.[gateFn as GateCheckName], true),
      ]);
    }

    throw new Error(`unexpected call to ${to}: ${data}`);
  };

  const provider = {
    call,
    getBlockNumber: async () => answer(fixture.blockNumber, 25_688_692),
  } as unknown as Provider;

  return { provider, calls };
};

const UNGATED_V2: Fixture['gates'] = {
  receiveSharesGate: ZeroAddress,
  sendSharesGate: ZeroAddress,
  receiveAssetsGate: ZeroAddress,
  sendAssetsGate: ZeroAddress,
};

/** The gate configuration `0x30cACd22…` actually reports on mainnet. */
const SHARE_GATED_V2: Fixture['gates'] = {
  receiveSharesGate: RECEIVE_SHARES_GATE,
  sendSharesGate: SEND_SHARES_GATE,
  receiveAssetsGate: ZeroAddress,
  sendAssetsGate: SEND_ASSETS_GATE,
};

const codes = (screening: { blockers: readonly { code: string }[] }): string[] =>
  screening.blockers.map(blocker => blocker.code);

describe('morpho-vault-screening', () => {
  describe('verifyMorphoVaultFactoryRegistration', () => {
    it('Should ask EVERY factory, because the registries are separate', async () => {
      // Verified on mainnet: the v1.0 factory answers isMetaMorpho(steakUSDC)
      // == true and the v1.1 factory answers false for the SAME vault. A
      // one-factory check would reject all 88 v1.0 vaults.
      const { provider, calls } = makeProvider({
        registeredBy: 'metamorpho-v1',
      });
      const registration = await verifyMorphoVaultFactoryRegistration({
        vaultAddress: V1_VAULT,
        provider,
      });

      expect(calls).to.have.length(3);
      expect(registration.registered).to.equal(true);
      expect(registration.factory?.generation).to.equal('metamorpho-v1');
      expect(registration.unreadable).to.deep.equal([]);
    });

    it('Should answer false only when every factory actually answered', async () => {
      const { provider } = makeProvider({});
      const registration = await verifyMorphoVaultFactoryRegistration({
        vaultAddress: USDC,
        provider,
      });
      expect(registration.registered).to.equal(false);
      expect(registration.factory).to.equal(undefined);
    });

    it('Should leave registration UNESTABLISHED when a read failed', async () => {
      // §9: "not found" and "could not look" are different answers. Mapping a
      // transport failure to `false` would condemn a real vault.
      const { provider } = makeProvider({
        registryAnswers: {
          [FACTORY_V1_0.address]: 'network',
          [FACTORY_V1_1.address]: 'network',
          [FACTORY_V2.address]: 'network',
        },
      });
      const registration = await verifyMorphoVaultFactoryRegistration({
        vaultAddress: V2_VAULT,
        provider,
      });
      expect(registration.registered).to.equal(undefined);
      expect(registration.unreadable).to.have.length(3);
    });

    it('Should treat a positive answer as conclusive despite a sibling failure', async () => {
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        registryAnswers: { [FACTORY_V1_0.address]: 'network' },
      });
      const registration = await verifyMorphoVaultFactoryRegistration({
        vaultAddress: V2_VAULT,
        provider,
      });
      expect(registration.registered).to.equal(true);
      expect(registration.factory?.generation).to.equal('vault-v2');
      expect(registration.unreadable).to.have.length(1);
    });
  });

  describe('screenMorphoVault', () => {
    it('Should clear a registered, ungated V1 vault', async () => {
      const { provider } = makeProvider({ registeredBy: 'metamorpho-v1' });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
      });

      expect(screening.ok).to.equal(true);
      expect(screening.blockers).to.deep.equal([]);
      expect(screening.generation).to.equal('metamorpho-v1');
      expect(screening.factoryAddress).to.equal(FACTORY_V1_0.address);
      expect(screening.gates?.supportsGates).to.equal(false);
      expect(screening.gates?.shareTransferGated).to.equal(false);
      expect(screening.quotable).to.equal(true);
      expect(screening.totalAssets).to.equal(1_000_000n);
      expect(screening.checkedAtBlock).to.equal(25_688_692);
      expect(screening.unchecked).to.contain(
        'per-account-gate-access (no account supplied)',
      );
    });

    it('Should clear a registered, ungated Vault V2', async () => {
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
        account: EXECUTOR,
      });

      expect(screening.ok).to.equal(true);
      expect(screening.generation).to.equal('vault-v2');
      expect(screening.gates?.supportsGates).to.equal(true);
      expect(screening.gates?.isGated).to.equal(false);
      // An unset gate is unconditionally permissive on-chain, so no per-account
      // call is made and none is owed.
      expect(screening.gateAccess).to.equal(undefined);
      expect(screening.unchecked).to.not.contain(
        'per-account-gate-access (no account supplied)',
      );
    });

    it('Should block a share-gated vault even for an allowlisted account', async () => {
      // The load-bearing case. The shield leg is transferFrom(executor ->
      // RAILGUN proxy) and V2 checks canSendShares(from) AND
      // canReceiveShares(to). The proxy is a fixed third party, so an executor
      // that passes every check STILL cannot complete the round trip — the
      // deposit succeeds and the shares are stuck public.
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: SHARE_GATED_V2,
        access: {
          canReceiveShares: true,
          canSendShares: true,
          canReceiveAssets: true,
          canSendAssets: true,
        },
      });
      const screening = await screenMorphoVault({
        vaultAddress: SHARE_GATED_VAULT,
        provider,
        account: EXECUTOR,
      });

      expect(screening.ok).to.equal(false);
      expect(codes(screening)).to.deep.equal(['share-gate']);
      expect(screening.gates?.shareTransferGated).to.equal(true);
      expect(screening.blockers[0].detail).to.contain(RECEIVE_SHARES_GATE);
      // The per-account question is not even asked: no answer to it can help.
      expect(screening.gateAccess).to.equal(undefined);
    });

    it('Should block a vault whose totalAssets REVERTS as unquotable', async () => {
      // Measured: 2 of the 658 live Vault V2 vaults do exactly this while still
      // answering asset() and totalSupply(). Every preview reverts with it.
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
        totalAssets: 'revert',
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
      });

      expect(codes(screening)).to.deep.equal(['unquotable']);
      expect(screening.quotable).to.equal(false);
      expect(screening.totalAssets).to.equal(undefined);
    });

    it('Should NOT call an unreachable totalAssets unquotable', async () => {
      // §9, and the reason `unquotable` and `unreadable` are separate codes: a
      // flaky RPC must not be able to condemn a healthy vault. This test fails
      // if the two are ever collapsed into one branch.
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
        totalAssets: 'network',
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
      });

      expect(codes(screening)).to.deep.equal(['unreadable']);
      expect(screening.quotable).to.equal(undefined);
      expect(screening.totalAssets).to.equal(undefined);
      expect(screening.ok).to.equal(false);
    });

    it('Should distinguish an EMPTY vault from an unread one', async () => {
      // 340 of the 1,108 live vaults hold nothing. That is a ranking signal, not
      // a blocker — a first depositor is legitimate — but it must never be the
      // same value as "could not read".
      const { provider } = makeProvider({
        registeredBy: 'metamorpho-v1.1',
        totalAssets: 0n,
      });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
      });

      expect(screening.ok).to.equal(true);
      expect(screening.totalAssets).to.equal(0n);
      expect(screening.quotable).to.equal(true);
    });

    it('Should block an address no factory claims', async () => {
      const { provider } = makeProvider({ gates: UNGATED_V2 });
      const screening = await screenMorphoVault({
        vaultAddress: WETH,
        provider,
      });

      expect(codes(screening)).to.contain('not-factory-registered');
      expect(screening.generation).to.equal(undefined);
      expect(screening.ok).to.equal(false);
    });

    it('Should call a refused asset() not-erc4626, not unreadable', async () => {
      // Reproduced live against WETH: its fallback swallows asset(). A contract
      // refusing the ERC-4626 surface is an ANSWER — retrying will not change
      // it — so it must not land in the bucket a caller retries.
      const { provider } = makeProvider({ asset: 'revert', gates: UNGATED_V2 });
      const screening = await screenMorphoVault({
        vaultAddress: WETH,
        provider,
      });

      expect(codes(screening)).to.contain('not-erc4626');
      expect(codes(screening)).to.not.contain('unreadable');
      expect(screening.assetAddress).to.equal(undefined);
    });

    it('Should call an unreachable asset() unreadable, not not-erc4626', async () => {
      const { provider } = makeProvider({
        registeredBy: 'metamorpho-v1',
        asset: 'network',
      });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
      });

      expect(codes(screening)).to.deep.equal(['unreadable']);
      expect(codes(screening)).to.not.contain('not-erc4626');
    });

    it('Should NOT condemn a vault whose registry reads all failed', async () => {
      // §9 again: an unread registry is not a registry that said no. This must
      // report `unreadable`, never `not-factory-registered`.
      const { provider } = makeProvider({
        gates: UNGATED_V2,
        registryAnswers: {
          [FACTORY_V1_0.address]: 'network',
          [FACTORY_V1_1.address]: 'network',
          [FACTORY_V2.address]: 'network',
        },
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
      });

      expect(codes(screening)).to.contain('unreadable');
      expect(codes(screening)).to.not.contain('not-factory-registered');
    });

    it('Should catch an asset mismatch before it becomes a wrong-token deposit', async () => {
      const { provider } = makeProvider({
        registeredBy: 'metamorpho-v1',
        asset: WETH,
      });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
        expectedAsset: USDC,
      });

      expect(codes(screening)).to.deep.equal(['asset-mismatch']);
      expect(screening.assetAddress).to.equal(WETH);
    });

    it('Should ask an asset-only gate about the account and pass a permissive one', async () => {
      // An asset gate never touches the share token, so a permissive one is
      // genuinely harmless — refusing on its mere presence would drop usable
      // vaults. Measured: 8 of the 51 gated V2 vaults are asset-gated only.
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: { ...UNGATED_V2, sendAssetsGate: SEND_ASSETS_GATE },
        access: { canSendAssets: true },
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
        account: EXECUTOR,
      });

      expect(screening.ok).to.equal(true);
      expect(screening.gates?.isGated).to.equal(true);
      expect(screening.gates?.shareTransferGated).to.equal(false);
      expect(screening.gateAccess?.canDeposit).to.equal(true);
    });

    it('Should block an asset-only gate that denies the account', async () => {
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: { ...UNGATED_V2, sendAssetsGate: SEND_ASSETS_GATE },
        access: { canSendAssets: false },
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
        account: EXECUTOR,
      });

      expect(codes(screening)).to.deep.equal(['asset-gate']);
      expect(screening.gateAccess?.canDeposit).to.equal(false);
      expect(screening.gateAccess?.canExit).to.equal(true);
    });

    it('Should skip the registry sweep when the factory is already known', async () => {
      const { provider, calls } = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
      });
      const screening = await screenMorphoVault({
        vaultAddress: V2_VAULT,
        provider,
        factory: FACTORY_V2,
      });

      expect(screening.ok).to.equal(true);
      expect(
        calls.filter(name => name.includes('isVaultV2')),
      ).to.have.length(1);
      expect(calls.filter(name => name.includes('isMetaMorpho'))).to.deep.equal(
        [],
      );
    });

    it('Should report an unreadable head rather than throwing', async () => {
      const { provider } = makeProvider({
        registeredBy: 'metamorpho-v1',
        blockNumber: 'network',
      });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
      });

      expect(screening.checkedAtBlock).to.equal(-1);
      expect(codes(screening)).to.contain('unreadable');
      expect(screening.ok).to.equal(false);
    });

    it('Should always name the checks it did not perform', async () => {
      const { provider } = makeProvider({ registeredBy: 'metamorpho-v1' });
      const screening = await screenMorphoVault({
        vaultAddress: V1_VAULT,
        provider,
      });
      // Present even when ok — a caller must tell "checked and fine" from
      // "never looked".
      expect(screening.ok).to.equal(true);
      expect(screening.unchecked).to.contain('same-block-guarantee');
      expect(screening.unchecked).to.contain('underlying-market-quality');
    });
  });

  describe('screenMorphoVaults', () => {
    const discovered = (
      vaultAddress: string,
      overrides?: Partial<MorphoDiscoveredVault>,
    ): MorphoDiscoveredVault => ({
      vaultAddress,
      assetAddress: USDC,
      generation: 'vault-v2',
      factoryAddress: FACTORY_V2.address,
      createdAtBlock: 23_500_000,
      initialOwner: EXECUTOR,
      salt: `0x${'00'.repeat(32)}`,
      canBeGated: true,
      ...overrides,
    });

    it('Should sort results into three disjoint buckets', async () => {
      const good = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
      });
      const gated = makeProvider({
        registeredBy: 'vault-v2',
        gates: SHARE_GATED_V2,
      });
      const flaky = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
        totalAssets: 'network',
      });

      // One provider per vault, routed by address.
      type CallTx = { to?: unknown; data?: unknown };
      type Caller = { call: (tx: CallTx) => Promise<string> };
      const route = (to: string): Caller => {
        if (to === SHARE_GATED_VAULT.toLowerCase()) {
          return gated.provider as unknown as Caller;
        }
        if (to === V1_VAULT.toLowerCase()) {
          return flaky.provider as unknown as Caller;
        }
        return good.provider as unknown as Caller;
      };
      const provider = {
        call: async (tx: CallTx) => route(String(tx.to).toLowerCase()).call(tx),
        getBlockNumber: async () => 25_688_692,
      } as unknown as Provider;

      const report = await screenMorphoVaults({
        vaults: [
          discovered(V2_VAULT),
          discovered(SHARE_GATED_VAULT),
          discovered(V1_VAULT),
        ],
        provider,
        concurrency: 2,
      });

      expect(report.screenings).to.have.length(3);
      expect(report.shieldable.map(s => s.vaultAddress)).to.deep.equal([
        V2_VAULT,
      ]);
      expect(report.blocked.map(s => s.vaultAddress)).to.deep.equal([
        SHARE_GATED_VAULT,
      ]);
      expect(report.unreadable.map(s => s.vaultAddress)).to.deep.equal([
        V1_VAULT,
      ]);
      // A partially-screened set is never reported as fully screened.
      expect(report.complete).to.equal(false);
      const bucketed =
        report.shieldable.length +
        report.blocked.length +
        report.unreadable.length;
      expect(bucketed).to.equal(report.screenings.length);
    });

    it('Should cross-check the creation log asset against the live asset', async () => {
      // The closest thing to self-verification these logs allow: it held on
      // 1,108 of 1,108 mainnet vaults, so a mismatch means the log was
      // mis-decoded or is not what it claims.
      const { provider } = makeProvider({
        registeredBy: 'vault-v2',
        gates: UNGATED_V2,
        asset: USDC,
      });
      const report = await screenMorphoVaults({
        vaults: [discovered(V2_VAULT, { assetAddress: WETH })],
        provider,
      });

      expect(codes(report.screenings[0])).to.deep.equal(['asset-mismatch']);
      expect(report.blocked).to.have.length(1);
    });

    it('Should reject a non-positive concurrency', async () => {
      const { provider } = makeProvider({});
      let threw = false;
      try {
        await screenMorphoVaults({ vaults: [], provider, concurrency: 0 });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });
});
