import chai from 'chai';
import {
  AbiCoder,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  id,
  type Provider,
  type TransactionRequest,
} from 'ethers';
import {
  assertFxTopLevelCallAllowed,
  getFxPool,
  getFxTopLevelCallGate,
} from '../fx-position-reader';
import {
  FX_ADDRESSES,
  FX_POOL_ABI,
  FX_POOL_CONFIGURATION_ABI,
  FX_POOL_MANAGER_ABI,
  FX_SHORT_POOL_MANAGER_ABI,
  FX_SMART_WALLET_CHECKER_ABI,
  FX_TOP_LEVEL_CALL_ABI,
  type Address,
} from '../../../../steps/borrow/fx/fx-mint-util';

const { expect } = chai;

const abiCoder = AbiCoder.defaultAbiCoder();

// Interfaces built from the shipped fragments — everything the stub provider
// answers is encoded through these, so a fragment typo shows up as a decode
// failure rather than a silently wrong number.
const topLevelCallIface = new Interface([...FX_TOP_LEVEL_CALL_ABI]);
const checkerIface = new Interface([...FX_SMART_WALLET_CHECKER_ABI]);
const poolIface = new Interface([...FX_POOL_ABI]);
const longManagerIface = new Interface([...FX_POOL_MANAGER_ABI]);
const shortManagerIface = new Interface([...FX_SHORT_POOL_MANAGER_ABI]);
const poolConfigIface = new Interface([...FX_POOL_CONFIGURATION_ABI]);

const selectorOf = (iface: Interface, name: string): string => {
  const fragment = iface.getFunction(name);
  if (fragment === null) {
    throw new Error(`fragment ${name} missing from ABI`);
  }
  return fragment.selector;
};

const WHITELIST_SELECTOR = selectorOf(topLevelCallIface, 'whitelist');
const CHECK_SELECTOR = selectorOf(checkerIface, 'check');

type StubCall = { to: string; data: string; selector: string };

/**
 * Minimal `ContractRunner` for read-only contract calls. ethers v6's
 * `staticCall` path only needs `.call`, and address resolution short-circuits
 * for hex addresses, so nothing else has to exist.
 */
const stubProvider = (
  respond: (call: StubCall) => string,
): { provider: Provider; calls: StubCall[] } => {
  const calls: StubCall[] = [];
  const runner = {
    call: (tx: TransactionRequest): Promise<string> => {
      const data = (tx.to == null ? '' : String(tx.data ?? '')) || '0x';
      const call: StubCall = {
        to: String(tx.to ?? '').toLowerCase(),
        data,
        selector: data.slice(0, 10),
      };
      calls.push(call);
      // Throwing synchronously inside an async chain is how a revert surfaces
      // from a real provider, so `respond` can model one by throwing.
      return Promise.resolve(respond(call));
    },
  };
  return { provider: runner as unknown as Provider, calls };
};

const encodeAddress = (address: string): string =>
  abiCoder.encode(['address'], [address]);

/**
 * ethers v6 tags every error it raises with a `code`. The reader keys off that
 * to tell a contract-level failure from a transport one, so a stub that throws
 * a bare `Error` would not exercise the real branch.
 */
const taggedError = (message: string, code: string): Error =>
  Object.assign(new Error(message), { code });

const CHECKER: Address = '0x1111111111111111111111111111111111111111';
const EPHEMERAL: Address = '0x2222222222222222222222222222222222222222';

describe('fx-position-reader — onlyTopLevelCall gate', () => {
  it('derives the whitelist() and check(address) selectors from the fragments', () => {
    // Independent derivation: keccak of the canonical signature, computed here
    // rather than copied from the fragment under test.
    expect(WHITELIST_SELECTOR).to.equal(id('whitelist()').slice(0, 10));
    expect(CHECK_SELECTOR).to.equal(id('check(address)').slice(0, 10));

    // Third anchor: both selectors were confirmed present in the deployed
    // PoolManager (0xa70DDDb8…) and ShortPoolManager (0x73a7b273…) runtime
    // bytecode on 2026-08-04. If a fragment is ever edited, this fails.
    expect(WHITELIST_SELECTOR).to.equal('0x93e59dc1');
    expect(CHECK_SELECTOR).to.equal('0xc23697a8');
  });

  it('reports "inert" and calls whitelist() on the pool\'s manager', async () => {
    const { provider, calls } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [ZeroAddress]),
    );

    const gate = await getFxTopLevelCallGate('wstETH-Long', provider);

    expect(gate.status).to.equal('inert');
    expect(gate.enforced).to.equal(false);
    expect(gate.blocksOperate).to.equal(false);
    expect(gate.whitelist).to.equal(ZeroAddress);
    expect(gate.poolManager).to.equal(FX_ADDRESSES.fxPoolManager);

    // Exactly one read, aimed at the manager and not the pool.
    expect(calls.length).to.equal(1);
    expect(calls[0].to).to.equal(FX_ADDRESSES.fxPoolManager.toLowerCase());
    expect(calls[0].data).to.equal(WHITELIST_SELECTOR);
  });

  it('routes a short pool to the short manager', async () => {
    const { provider, calls } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [ZeroAddress]),
    );

    const gate = await getFxTopLevelCallGate('WBTC-Short', provider);

    expect(gate.poolManager).to.equal(FX_ADDRESSES.fxShortPoolManager);
    expect(calls[0].to).to.equal(FX_ADDRESSES.fxShortPoolManager.toLowerCase());
  });

  it('does not consult the checker when the gate is inert, even with a caller', async () => {
    const { provider, calls } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [ZeroAddress]),
    );

    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );

    expect(gate.status).to.equal('inert');
    expect(gate.blocksOperate).to.equal(false);
    expect(gate.caller).to.equal(EPHEMERAL);
    expect(calls.length).to.equal(1);
  });

  it('reports "enforced-caller-unknown" when the gate is on and no caller is given', async () => {
    const { provider, calls } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER]),
    );

    const gate = await getFxTopLevelCallGate('wstETH-Long', provider);

    expect(gate.status).to.equal('enforced-caller-unknown');
    expect(gate.enforced).to.equal(true);
    // Conservative: unproven is treated as blocking.
    expect(gate.blocksOperate).to.equal(true);
    expect(gate.whitelist).to.equal(CHECKER);
    expect(gate.caller).to.equal(undefined);
    // No point asking the checker about an account that does not exist yet.
    expect(calls.length).to.equal(1);
  });

  it('reports "blocked" when the checker rejects the caller', async () => {
    const { provider, calls } = stubProvider(call => {
      if (call.selector === WHITELIST_SELECTOR) {
        return topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER]);
      }
      return checkerIface.encodeFunctionResult('check', [false]);
    });

    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );

    expect(gate.status).to.equal('blocked');
    expect(gate.blocksOperate).to.equal(true);
    expect(gate.caller).to.equal(EPHEMERAL);

    // The checker is asked about the CALLER, not about the pool or operator.
    expect(calls.length).to.equal(2);
    expect(calls[1].to).to.equal(CHECKER.toLowerCase());
    expect(calls[1].data).to.equal(
      checkerIface.encodeFunctionData('check', [EPHEMERAL]),
    );
  });

  it('reports "allowed" when the checker accepts the caller', async () => {
    const { provider } = stubProvider(call =>
      call.selector === WHITELIST_SELECTOR
        ? topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER])
        : checkerIface.encodeFunctionResult('check', [true]),
    );

    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );

    expect(gate.status).to.equal('allowed');
    expect(gate.enforced).to.equal(true);
    expect(gate.blocksOperate).to.equal(false);
  });

  it('reports "enforced-checker-unreadable" when check() reverts, and keeps blocking', async () => {
    const { provider } = stubProvider(call => {
      if (call.selector === WHITELIST_SELECTOR) {
        return topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER]);
      }
      throw taggedError('execution reverted: not a checker', 'CALL_EXCEPTION');
    });

    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );

    expect(gate.status).to.equal('enforced-checker-unreadable');
    expect(gate.blocksOperate).to.equal(true);
    expect(gate.checkerError ?? '').to.contain('not a checker');
  });

  it('reports "enforced-checker-unreadable" when check() returns undecodable data', async () => {
    const { provider } = stubProvider(call =>
      call.selector === WHITELIST_SELECTOR
        ? topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER])
        : // Empty return: ethers raises BAD_DATA rather than a revert.
          '0x',
    );

    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );

    expect(gate.status).to.equal('enforced-checker-unreadable');
    expect(gate.blocksOperate).to.equal(true);
  });

  it('propagates a TRANSPORT failure instead of reporting it as a gate verdict', async () => {
    // "The RPC timed out" is not a statement about f(x)'s configuration.
    // Folding it into `blocksOperate` would tell an integrator something false.
    const { provider } = stubProvider(call => {
      if (call.selector === WHITELIST_SELECTOR) {
        return topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER]);
      }
      throw taggedError('could not reach the node', 'SERVER_ERROR');
    });

    let raised: Error | undefined;
    try {
      await getFxTopLevelCallGate('wstETH-Long', provider, EPHEMERAL);
    } catch (err) {
      raised = err as Error;
    }
    expect(raised?.message).to.equal('could not reach the node');
  });

  it('propagates a failure of the whitelist() read itself', async () => {
    const { provider } = stubProvider(() => {
      throw taggedError('no such contract', 'CALL_EXCEPTION');
    });

    let raised: Error | undefined;
    try {
      await getFxTopLevelCallGate('wstETH-Long', provider);
    } catch (err) {
      raised = err as Error;
    }
    expect(raised?.message).to.equal('no such contract');
  });

  it('normalises a lowercase caller before asking the checker', async () => {
    const { provider, calls } = stubProvider(call =>
      call.selector === WHITELIST_SELECTOR
        ? topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER])
        : checkerIface.encodeFunctionResult('check', [false]),
    );

    // Checksum-mixed input; result must come back checksummed.
    const gate = await getFxTopLevelCallGate(
      'wstETH-Long',
      provider,
      '0xac9f360ae85469b27aeddeafc579ef2d052ad405',
    );

    expect(gate.caller).to.equal('0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405');
    expect(calls[1].data).to.equal(
      checkerIface.encodeFunctionData('check', [
        '0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405',
      ]),
    );
  });
});

describe('fx-position-reader — assertFxTopLevelCallAllowed', () => {
  const expectRejection = async (
    promise: Promise<unknown>,
  ): Promise<Error> => {
    try {
      await promise;
    } catch (err) {
      return err as Error;
    }
    throw new Error('expected the guard to throw, but it resolved');
  };

  it('returns the gate when the gate is inert', async () => {
    const { provider } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [ZeroAddress]),
    );

    const gate = await assertFxTopLevelCallAllowed('wstETH-Long', provider);
    expect(gate.status).to.equal('inert');
  });

  it('returns the gate when the checker accepts the caller', async () => {
    const { provider } = stubProvider(call =>
      call.selector === WHITELIST_SELECTOR
        ? topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER])
        : checkerIface.encodeFunctionResult('check', [true]),
    );

    const gate = await assertFxTopLevelCallAllowed(
      'wstETH-Long',
      provider,
      EPHEMERAL,
    );
    expect(gate.status).to.equal('allowed');
  });

  it('throws a diagnosable error naming the manager, whitelist and status', async () => {
    const { provider } = stubProvider(call =>
      call.selector === WHITELIST_SELECTOR
        ? topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER])
        : checkerIface.encodeFunctionResult('check', [false]),
    );

    const err = await expectRejection(
      assertFxTopLevelCallAllowed('wstETH-Long', provider, EPHEMERAL),
    );

    expect(err.message).to.contain('fxmint:');
    expect(err.message).to.contain(FX_ADDRESSES.fxPoolManager);
    expect(err.message).to.contain(CHECKER);
    expect(err.message).to.contain(EPHEMERAL);
    expect(err.message).to.contain('"blocked"');
    // The on-chain condition, by name — this is what makes it greppable when
    // it turns up in a wallet's logs.
    expect(err.message).to.contain('ErrorTopLevelCall()');
    // The reason a receipt will not show it.
    expect(err.message).to.contain('requireSuccess=false');
  });

  it('throws for an enforced gate with no caller supplied', async () => {
    const { provider } = stubProvider(() =>
      topLevelCallIface.encodeFunctionResult('whitelist', [CHECKER]),
    );

    const err = await expectRejection(
      assertFxTopLevelCallAllowed('wstETH-Long', provider),
    );
    expect(err.message).to.contain('"enforced-caller-unknown"');
  });
});

describe('fx-position-reader — getFxPool carries the gate', () => {
  /**
   * Answers every read `getFxPool` makes, dispatching on selector. Values are
   * arbitrary but shaped correctly; only the gate is asserted here.
   */
  const poolStateProvider = (side: 'long' | 'short', whitelist: string) =>
    stubProvider(call => {
      switch (call.selector) {
        case WHITELIST_SELECTOR:
          return topLevelCallIface.encodeFunctionResult('whitelist', [
            whitelist,
          ]);
        case selectorOf(longManagerIface, 'getPoolInfo'):
          return side === 'long'
            ? longManagerIface.encodeFunctionResult('getPoolInfo', [
                1n,
                2n,
                3n,
                4n,
                5n,
              ])
            : shortManagerIface.encodeFunctionResult('getPoolInfo', [
                1n,
                2n,
                3n,
                4n,
              ]);
        case selectorOf(shortManagerIface, 'tokenRates'):
          // scalar = 1e18 (identity), no rate provider.
          return shortManagerIface.encodeFunctionResult('tokenRates', [
            10n ** 18n,
            ZeroAddress,
          ]);
        case selectorOf(poolIface, 'getTotalRawCollaterals'):
          return poolIface.encodeFunctionResult('getTotalRawCollaterals', [10n]);
        case selectorOf(poolIface, 'getLiquidateRatios'):
          return poolIface.encodeFunctionResult('getLiquidateRatios', [1n, 2n]);
        case selectorOf(poolIface, 'getRebalanceRatios'):
          return poolIface.encodeFunctionResult('getRebalanceRatios', [1n, 2n]);
        case selectorOf(poolConfigIface, 'getPoolFeeRatio'):
          return poolConfigIface.encodeFunctionResult('getPoolFeeRatio', [
            0n,
            0n,
            0n,
            0n,
          ]);
        default:
          throw new Error(`unstubbed selector ${call.selector}`);
      }
    });

  it('populates topLevelCallGate from the LONG manager', async () => {
    const { provider, calls } = poolStateProvider('long', ZeroAddress);
    const pool = await getFxPool('wstETH-Long', provider);

    expect(pool.topLevelCallGate.status).to.equal('inert');
    expect(pool.topLevelCallGate.poolManager).to.equal(
      FX_ADDRESSES.fxPoolManager,
    );
    const whitelistCalls = calls.filter(
      c => c.selector === WHITELIST_SELECTOR,
    );
    expect(whitelistCalls.length).to.equal(1);
    expect(whitelistCalls[0].to).to.equal(
      FX_ADDRESSES.fxPoolManager.toLowerCase(),
    );
  });

  it('populates topLevelCallGate from the SHORT manager', async () => {
    const { provider, calls } = poolStateProvider('short', ZeroAddress);
    const pool = await getFxPool('WBTC-Short', provider);

    expect(pool.topLevelCallGate.poolManager).to.equal(
      FX_ADDRESSES.fxShortPoolManager,
    );
    expect(
      calls.filter(c => c.selector === WHITELIST_SELECTOR)[0].to,
    ).to.equal(FX_ADDRESSES.fxShortPoolManager.toLowerCase());
  });

  it('surfaces an enabled gate without throwing, and without borrowing `operator` as the caller', async () => {
    const { provider } = poolStateProvider('long', CHECKER);

    // A reader must not fail on a legitimate on-chain state — governance
    // turning the gate on must not break every position UI.
    const pool = await getFxPool('wstETH-Long', provider, EPHEMERAL);

    expect(pool.topLevelCallGate.status).to.equal('enforced-caller-unknown');
    expect(pool.topLevelCallGate.blocksOperate).to.equal(true);
    // `operator` addresses the fee table, not msg.sender. Conflating them would
    // report a confident verdict about the wrong account.
    expect(pool.topLevelCallGate.caller).to.equal(undefined);
  });
});

describe('fx-position-reader — live onlyTopLevelCall gate [requires RUN_FORK_TESTS=1]', function () {
  this.timeout(30_000);

  if ((process.env.RUN_FORK_TESTS ?? '') === '') {
    it.skip('skipped — set RUN_FORK_TESTS=1 to run', () => {});
    return;
  }

  const rpcUrl =
    process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
  const provider = new JsonRpcProvider(rpcUrl);

  // Measured 2026-08-04 against mainnet head on two independent RPCs
  // (publicnode, mevblocker): address(0) on both managers, so the gate is
  // inert. It is `address public immutable whitelist` on both, written only in
  // the constructor — so this can only change via a proxy upgrade, and this
  // test failing means exactly that has happened.
  it('reads whitelist() == address(0) on the LONG manager', async () => {
    const gate = await getFxTopLevelCallGate('wstETH-Long', provider);
    expect(gate.poolManager).to.equal(FX_ADDRESSES.fxPoolManager);
    expect(gate.whitelist).to.equal(ZeroAddress);
    expect(gate.status).to.equal('inert');
    expect(gate.blocksOperate).to.equal(false);
  });

  it('reads whitelist() == address(0) on the SHORT manager', async () => {
    const gate = await getFxTopLevelCallGate('WBTC-Short', provider);
    expect(gate.poolManager).to.equal(FX_ADDRESSES.fxShortPoolManager);
    expect(gate.whitelist).to.equal(ZeroAddress);
    expect(gate.status).to.equal('inert');
  });

  it('the whitelist() fragment decodes against the deployed managers', async () => {
    // Guards against the fragment drifting into something that still encodes a
    // valid selector but mis-declares the return type.
    for (const manager of [
      FX_ADDRESSES.fxPoolManager,
      FX_ADDRESSES.fxShortPoolManager,
    ]) {
      const raw = await provider.call({
        to: manager,
        data: WHITELIST_SELECTOR,
      });
      expect(raw).to.equal(encodeAddress(ZeroAddress));
    }
  });
});
