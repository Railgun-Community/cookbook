import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Interface, Provider, ZeroAddress } from 'ethers';
import { abi } from '../../../../abi/abi';
import {
  MORPHO_VAULT_V2_GATE_ABI,
  MorphoVaultV2GateName,
} from '../../../../contract/vault/morpho/metamorpho-vault-contract';
import {
  MorphoVaultAPI,
  MorphoVaultGatedError,
} from '../metamorpho-vault-api';

chai.use(chaiAsPromised);
const { expect } = chai;

// Steakhouse USDC — a V1 MetaMorpho vault. Verified on Ethereum mainnet
// (block 25_682_207): answers MORPHO() == 0xBBBB...FFCb and REVERTS on all four
// Vault V2 gate getters. V1 has no gating mechanism.
const V1_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
// Steakhouse Prime USDC — a Morpho Vault V2. Same verification run: reverts on
// MORPHO() and answers all four gate getters with address(0). Not gated today,
// which is why enforcing the check below is a no-op for both shipped vaults.
const V2_VAULT = '0xbeef088055857739C12CD3765F20b7679Def0f51';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const GATE_CONTRACT = '0x1111111111111111111111111111111111111111';

const gateIface = new Interface(MORPHO_VAULT_V2_GATE_ABI);
const vaultIface = new Interface(abi.vault.metaMorpho as never);
const erc20Iface = new Interface(abi.token.erc20 as never);

type GateCheckName =
  | 'canReceiveShares'
  | 'canSendShares'
  | 'canReceiveAssets'
  | 'canSendAssets';

/** `'revert'` = empty revert; `'network'` = a transport failure, not a revert. */
type Answer<T> = T | 'revert' | 'network';

type Fixture = {
  /**
   * Gate addresses the vault reports. `undefined` for a whole gate means that
   * getter reverts — which is what a V1 MetaMorpho vault does for all four.
   */
  gates?: Partial<Record<MorphoVaultV2GateName, Answer<string>>>;
  access?: Partial<Record<GateCheckName, Answer<boolean>>>;
  /** ERC-4626 metadata, only needed by the get*Quote tests. */
  previewResult?: bigint;
};

const revertError = (): Error =>
  Object.assign(new Error('execution reverted'), {
    code: 'CALL_EXCEPTION',
    data: null,
  });

const networkError = (): Error =>
  Object.assign(new Error('connection refused'), { code: 'NETWORK_ERROR' });

/**
 * Minimal ethers v6 `ContractRunner`. `Contract` only needs `call` for a static
 * read, so this is a complete stand-in for a provider without a node.
 */
const makeProvider = (
  fixture: Fixture,
): { provider: Provider; calls: string[] } => {
  const calls: string[] = [];

  const call = async (tx: { to?: unknown; data?: unknown }): Promise<string> => {
    const to = String(tx.to);
    const data = String(tx.data);

    const gateFn = MORPHO_VAULT_V2_GATE_ABI.map(f => f.name).find(
      name => gateIface.getFunction(name)?.selector === data.slice(0, 10),
    );
    if (gateFn !== undefined) {
      calls.push(gateFn);
      if (
        gateFn === 'receiveSharesGate' ||
        gateFn === 'sendSharesGate' ||
        gateFn === 'receiveAssetsGate' ||
        gateFn === 'sendAssetsGate'
      ) {
        const answer = fixture.gates?.[gateFn];
        if (answer === undefined || answer === 'revert') {
          throw revertError();
        }
        if (answer === 'network') {
          throw networkError();
        }
        return gateIface.encodeFunctionResult(gateFn, [answer]);
      }
      const answer = fixture.access?.[gateFn] ?? true;
      if (answer === 'revert') {
        throw revertError();
      }
      if (answer === 'network') {
        throw networkError();
      }
      return gateIface.encodeFunctionResult(gateFn, [answer]);
    }

    // ERC-4626 metadata + previews, for the get*Quote paths.
    if (data.startsWith(vaultIface.getFunction('asset')?.selector ?? 'x')) {
      calls.push('asset');
      return vaultIface.encodeFunctionResult('asset', [USDC]);
    }
    if (data.startsWith(erc20Iface.getFunction('decimals')?.selector ?? 'x')) {
      calls.push(`decimals:${to}`);
      return erc20Iface.encodeFunctionResult('decimals', [
        to.toLowerCase() === USDC.toLowerCase() ? 6 : 18,
      ]);
    }
    for (const preview of [
      'previewDeposit',
      'previewRedeem',
      'previewWithdraw',
    ] as const) {
      if (data.startsWith(vaultIface.getFunction(preview)?.selector ?? 'x')) {
        calls.push(preview);
        return vaultIface.encodeFunctionResult(preview, [
          fixture.previewResult ?? 1n,
        ]);
      }
    }
    throw new Error(`unexpected call to ${to}: ${data}`);
  };

  return { provider: { call } as unknown as Provider, calls };
};

const UNGATED_V2: Fixture['gates'] = {
  receiveSharesGate: ZeroAddress,
  sendSharesGate: ZeroAddress,
  receiveAssetsGate: ZeroAddress,
  sendAssetsGate: ZeroAddress,
};

const gatedV2 = (gate: MorphoVaultV2GateName): Fixture['gates'] => ({
  ...UNGATED_V2,
  [gate]: GATE_CONTRACT,
});

describe('metamorpho-vault-gate', () => {
  describe('getVaultGates', () => {
    it('Should report a V1 MetaMorpho vault as ungated (all getters revert)', async () => {
      const { provider } = makeProvider({});
      const gates = await MorphoVaultAPI.getVaultGates(V1_VAULT, provider);

      expect(gates.supportsGates).to.equal(false);
      expect(gates.receiveSharesGate).to.equal(undefined);
      expect(gates.sendSharesGate).to.equal(undefined);
      expect(gates.receiveAssetsGate).to.equal(undefined);
      expect(gates.sendAssetsGate).to.equal(undefined);
      expect(gates.isGated).to.equal(false);
      expect(gates.depositGated).to.equal(false);
      expect(gates.exitGated).to.equal(false);
      expect(gates.shareTransferGated).to.equal(false);
    });

    it('Should report a V2 vault with all gates unset as ungated', async () => {
      const { provider } = makeProvider({ gates: UNGATED_V2 });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.supportsGates).to.equal(true);
      expect(gates.receiveSharesGate).to.equal(ZeroAddress);
      expect(gates.isGated).to.equal(false);
      expect(gates.depositGated).to.equal(false);
      expect(gates.exitGated).to.equal(false);
      expect(gates.shareTransferGated).to.equal(false);
    });

    it('Should map receiveSharesGate to the deposit AND share-transfer legs', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
      });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.isGated).to.equal(true);
      // enter() checks canReceiveShares(onBehalf); transfer() checks it on `to`.
      expect(gates.depositGated).to.equal(true);
      expect(gates.shareTransferGated).to.equal(true);
      expect(gates.exitGated).to.equal(false);
    });

    it('Should map sendSharesGate to the exit AND share-transfer legs', async () => {
      const { provider } = makeProvider({ gates: gatedV2('sendSharesGate') });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.isGated).to.equal(true);
      expect(gates.exitGated).to.equal(true);
      expect(gates.shareTransferGated).to.equal(true);
      expect(gates.depositGated).to.equal(false);
    });

    it('Should map sendAssetsGate to the deposit leg only (it gates DEPOSITING)', async () => {
      const { provider } = makeProvider({ gates: gatedV2('sendAssetsGate') });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.isGated).to.equal(true);
      expect(gates.depositGated).to.equal(true);
      expect(gates.exitGated).to.equal(false);
      expect(gates.shareTransferGated).to.equal(false);
    });

    it('Should map receiveAssetsGate to the exit leg only (it gates WITHDRAWING)', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('receiveAssetsGate'),
      });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.isGated).to.equal(true);
      expect(gates.exitGated).to.equal(true);
      expect(gates.depositGated).to.equal(false);
      expect(gates.shareTransferGated).to.equal(false);
    });

    it('Should fail closed when a V2 vault answers only some gate getters', async () => {
      const { provider } = makeProvider({
        gates: { ...UNGATED_V2, sendSharesGate: 'revert' },
      });
      const gates = await MorphoVaultAPI.getVaultGates(V2_VAULT, provider);

      expect(gates.supportsGates).to.equal(true);
      expect(gates.sendSharesGate).to.equal(undefined);
      // Unreadable on a vault that demonstrably HAS gates → treat as set.
      expect(gates.isGated).to.equal(true);
      expect(gates.exitGated).to.equal(true);
      expect(gates.shareTransferGated).to.equal(true);
    });

    it('Should rethrow a transport error rather than downgrade to "ungated"', async () => {
      const { provider } = makeProvider({
        gates: { ...UNGATED_V2, receiveSharesGate: 'network' },
      });
      await expect(
        MorphoVaultAPI.getVaultGates(V2_VAULT, provider),
      ).to.eventually.be.rejectedWith('connection refused');
    });
  });

  describe('isGated', () => {
    it('Should be false for a V1 vault and for an ungated V2 vault', async () => {
      expect(
        await MorphoVaultAPI.isGated(V1_VAULT, makeProvider({}).provider),
      ).to.equal(false);
      expect(
        await MorphoVaultAPI.isGated(
          V2_VAULT,
          makeProvider({ gates: UNGATED_V2 }).provider,
        ),
      ).to.equal(false);
    });

    it('Should be true when any single gate is attached', async () => {
      for (const gate of [
        'receiveSharesGate',
        'sendSharesGate',
        'receiveAssetsGate',
        'sendAssetsGate',
      ] as const) {
        const { provider } = makeProvider({ gates: gatedV2(gate) });
        // eslint-disable-next-line no-await-in-loop
        expect(await MorphoVaultAPI.isGated(V2_VAULT, provider)).to.equal(
          true,
          gate,
        );
      }
    });
  });

  describe('getGateAccess', () => {
    it('Should allow everything and make NO can* calls when no gate is set', async () => {
      const { provider, calls } = makeProvider({ gates: UNGATED_V2 });
      const access = await MorphoVaultAPI.getGateAccess({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        provider,
      });

      expect(access.canReceiveShares).to.equal(true);
      expect(access.canSendShares).to.equal(true);
      expect(access.canReceiveAssets).to.equal(true);
      expect(access.canSendAssets).to.equal(true);
      expect(access.canDeposit).to.equal(true);
      expect(access.canExit).to.equal(true);
      expect(calls.filter(name => name.startsWith('can'))).to.deep.equal([]);
    });

    it('Should consult the gate for a configured leg and report a denial', async () => {
      const { provider, calls } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
        access: { canReceiveShares: false },
      });
      const access = await MorphoVaultAPI.getGateAccess({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        provider,
      });

      expect(access.canReceiveShares).to.equal(false);
      expect(access.canDeposit).to.equal(false);
      // Unset gates are still not queried.
      expect(calls.filter(name => name.startsWith('can'))).to.deep.equal([
        'canReceiveShares',
      ]);
    });

    it('Should treat a REVERTING gate as denied, not as unknown', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('sendSharesGate'),
        access: { canSendShares: 'revert' },
      });
      const access = await MorphoVaultAPI.getGateAccess({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        provider,
      });

      expect(access.canSendShares).to.equal(false);
      expect(access.canExit).to.equal(false);
    });

    it('Should rethrow a transport error from a gate check', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('sendAssetsGate'),
        access: { canSendAssets: 'network' },
      });
      await expect(
        MorphoVaultAPI.getGateAccess({
          vaultAddress: V2_VAULT,
          account: EXECUTOR,
          provider,
        }),
      ).to.eventually.be.rejectedWith('connection refused');
    });
  });

  describe('assertVaultUsable', () => {
    it('Should pass for a V1 vault and for an ungated V2 vault', async () => {
      await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V1_VAULT,
        account: EXECUTOR,
        operation: 'deposit',
        provider: makeProvider({}).provider,
      });
      await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        operation: 'exit',
        provider: makeProvider({ gates: UNGATED_V2 }).provider,
      });
    });

    it('Should refuse on ANY share gate even when the executor itself passes', async () => {
      // The shield leg is transferFrom(executor -> RAILGUN contract) and the
      // vault gate-checks BOTH endpoints, so an allowlisted executor is not
      // sufficient: the shares would be minted and then be unshieldable.
      const { provider } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
        access: { canReceiveShares: true },
      });
      await expect(
        MorphoVaultAPI.assertVaultUsable({
          vaultAddress: V2_VAULT,
          account: EXECUTOR,
          operation: 'deposit',
          provider,
        }),
      ).to.eventually.be.rejectedWith(MorphoVaultGatedError);
    });

    it('Should allow a permissive ASSET gate that says yes for this account', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('sendAssetsGate'),
        access: { canSendAssets: true },
      });
      await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        operation: 'deposit',
        provider,
      });
    });

    it('Should refuse a deposit when sendAssetsGate denies the account', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('sendAssetsGate'),
        access: { canSendAssets: false },
      });
      const error = await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        operation: 'deposit',
        provider,
      }).catch((err: unknown) => err);

      expect(error).to.be.instanceOf(MorphoVaultGatedError);
      const gatedError = error as MorphoVaultGatedError;
      expect(gatedError.operation).to.equal('deposit');
      expect(gatedError.account).to.equal(EXECUTOR);
      expect(gatedError.gates.sendAssetsGate).to.equal(GATE_CONTRACT);
      expect(gatedError.message).to.include(V2_VAULT);
    });

    it('Should separate the legs: receiveAssetsGate blocks exit, not deposit', async () => {
      const fixture: Fixture = {
        gates: gatedV2('receiveAssetsGate'),
        access: { canReceiveAssets: false },
      };
      await expect(
        MorphoVaultAPI.assertVaultUsable({
          vaultAddress: V2_VAULT,
          account: EXECUTOR,
          operation: 'exit',
          provider: makeProvider(fixture).provider,
        }),
      ).to.eventually.be.rejectedWith(MorphoVaultGatedError);

      // A deposit never touches receiveAssetsGate, so it must still build.
      await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        operation: 'deposit',
        provider: makeProvider(fixture).provider,
      });
    });

    it('Should skip the read entirely when allowGatedVault is set', async () => {
      const { provider, calls } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
      });
      await MorphoVaultAPI.assertVaultUsable({
        vaultAddress: V2_VAULT,
        account: EXECUTOR,
        operation: 'deposit',
        provider,
        allowGatedVault: true,
      });
      expect(calls).to.deep.equal([]);
    });
  });

  describe('get*Quote gate enforcement', () => {
    const quoteArgs = {
      vaultAddress: V2_VAULT,
      slippageBasisPoints: 50n,
      recipient: EXECUTOR,
    };

    it('Should build a deposit quote against an ungated vault', async () => {
      const { provider } = makeProvider({
        gates: UNGATED_V2,
        previewResult: 10n ** 18n,
      });
      const quote = await MorphoVaultAPI.getDepositQuote({
        ...quoteArgs,
        depositAssets: 1_000_000n,
        provider,
      });
      expect(quote.expectedShares).to.equal(10n ** 18n);
      expect(quote.receiver).to.equal(EXECUTOR);
    });

    it('Should refuse a deposit quote against a gated vault', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
        previewResult: 10n ** 18n,
      });
      await expect(
        MorphoVaultAPI.getDepositQuote({
          ...quoteArgs,
          depositAssets: 1_000_000n,
          provider,
        }),
      ).to.eventually.be.rejectedWith(MorphoVaultGatedError);
    });

    it('Should refuse a redeem quote against a gated vault', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('sendSharesGate'),
        previewResult: 1_000_000n,
      });
      await expect(
        MorphoVaultAPI.getRedeemQuote({
          ...quoteArgs,
          redeemShares: 10n ** 18n,
          provider,
        }),
      ).to.eventually.be.rejectedWith(MorphoVaultGatedError);
    });

    it('Should refuse a withdraw-by-assets quote against a gated vault', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('receiveAssetsGate'),
        access: { canReceiveAssets: false },
        previewResult: 10n ** 18n,
      });
      await expect(
        MorphoVaultAPI.getWithdrawQuote({
          ...quoteArgs,
          withdrawAssets: 1_000_000n,
          provider,
        }),
      ).to.eventually.be.rejectedWith(MorphoVaultGatedError);
    });

    it('Should build against a gated vault when the caller opts out', async () => {
      const { provider } = makeProvider({
        gates: gatedV2('receiveSharesGate'),
        previewResult: 10n ** 18n,
      });
      const quote = await MorphoVaultAPI.getDepositQuote({
        ...quoteArgs,
        depositAssets: 1_000_000n,
        provider,
        allowGatedVault: true,
      });
      expect(quote.expectedShares).to.equal(10n ** 18n);
    });
  });
});
