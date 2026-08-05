import chai from 'chai';
import {
  Contract,
  Interface,
  InterfaceAbi,
  JsonRpcProvider,
  Provider,
  TransactionRequest,
  ZeroAddress,
  getAddress,
} from 'ethers';
import { abi } from '../../../../abi/abi';
import {
  FX_ADDRESSES,
  KNOWN_POOLS,
} from '../../../../steps/borrow/fx/fx-mint-util';
import {
  FX_CREDIT_NOTE_ABI,
  FX_SHORT_POOL_CREDIT_NOTE_ABI,
  assertFxCreditNoteReportComplete,
  getFxCreditNote,
  getFxCreditNoteBalances,
} from '../fx-credit-note-reader';

const { expect } = chai;

const poolAddress = (name: string): string => {
  const entry = KNOWN_POOLS.find(
    (known: (typeof KNOWN_POOLS)[number]) => known.name === name,
  );
  if (entry === undefined) {
    throw new Error(`test fixture: unknown pool ${name}`);
  }
  return entry.address.toLowerCase();
};

const STETH_SHORT = poolAddress('stETH-Short');
const WBTC_SHORT = poolAddress('WBTC-Short');

// Fixture note addresses. Only their identity matters offline.
const CN_A = getAddress('0x7c5350BaC0eB97F86A366Ee4F9619a560480F05A');
const CN_B = getAddress('0xB25a554033C59e33e48c5dc05A7192Fb1bbDdfc6');

const HOLDER = getAddress('0x250893CA4Ba5d05626C785e8da758026928FCD24');
const EXECUTOR = getAddress('0x1111111111111111111111111111111111111111');

const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);
const poolIface = new Interface(
  FX_SHORT_POOL_CREDIT_NOTE_ABI as unknown as InterfaceAbi,
);
const noteIface = new Interface(FX_CREDIT_NOTE_ABI as unknown as InterfaceAbi);

type StubOptions = {
  /** Pool address -> what `creditNote()` answers, or 'revert'. */
  notes?: Record<string, string | 'revert'>;
  /** `${note}:${account}` -> balance. Missing keys read as 0n. */
  balances?: Record<string, bigint>;
  /** `${note}:${account}` pairs whose `balanceOf` reverts. */
  failBalances?: Set<string>;
  /** Note addresses whose ERC-20 metadata reverts. */
  failMetadata?: Set<string>;
  /** Every call the stub served, for "did it call at all" assertions. */
  calls?: string[];
};

const makeStubProvider = (options: StubOptions = {}): Provider => {
  const notes: Record<string, string | 'revert'> = options.notes ?? {
    [STETH_SHORT]: CN_A,
    [WBTC_SHORT]: CN_B,
  };
  const noteAddresses = new Set(
    Object.values(notes)
      .filter(value => value !== 'revert')
      .map(value => String(value).toLowerCase()),
  );

  const call = async (tx: TransactionRequest): Promise<string> => {
    const to = String(tx.to).toLowerCase();
    const data = String(tx.data);
    const selector = data.slice(0, 10);
    options.calls?.push(`${to}:${selector}`);

    const configured = notes[to];
    if (configured !== undefined) {
      if (selector !== poolIface.getFunction('creditNote')?.selector) {
        throw new Error(`stub: unexpected pool call ${selector}`);
      }
      if (configured === 'revert') {
        throw new Error(`stub: creditNote() reverted on ${to}`);
      }
      return poolIface.encodeFunctionResult('creditNote', [configured]);
    }

    if (noteAddresses.has(to)) {
      const note = getAddress(to);
      if (selector === noteIface.getFunction('poolManager')?.selector) {
        if (options.failMetadata?.has(note) === true) {
          throw new Error(`stub: poolManager() reverted on ${note}`);
        }
        return noteIface.encodeFunctionResult('poolManager', [HOLDER]);
      }
      if (selector === erc20Iface.getFunction('balanceOf')?.selector) {
        const [account] = erc20Iface.decodeFunctionData('balanceOf', data);
        const key = `${note}:${getAddress(String(account))}`;
        if (options.failBalances?.has(key) === true) {
          throw new Error(`stub: balanceOf reverted for ${key}`);
        }
        return erc20Iface.encodeFunctionResult('balanceOf', [
          options.balances?.[key] ?? 0n,
        ]);
      }
      if (options.failMetadata?.has(note) === true) {
        throw new Error(`stub: metadata reverted on ${note}`);
      }
      if (selector === erc20Iface.getFunction('symbol')?.selector) {
        return erc20Iface.encodeFunctionResult('symbol', ['xx-CN']);
      }
      if (selector === erc20Iface.getFunction('decimals')?.selector) {
        return erc20Iface.encodeFunctionResult('decimals', [18n]);
      }
      if (selector === erc20Iface.getFunction('totalSupply')?.selector) {
        return erc20Iface.encodeFunctionResult('totalSupply', [1_000n]);
      }
    }

    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };

  return { call } as unknown as Provider;
};

describe('fx credit note reader — resolution', () => {
  it('answers "long pools have none" without issuing a call', async () => {
    // The claim is structural: `creditNote()` does not exist on a long pool,
    // so a read would revert — and a revert is not distinguishable from a dead
    // RPC. The `none-long-pool` verdict alone does not prove the reader knew
    // that; a reader that called and swallowed the revert would answer the
    // same. So count the calls: zero is the assertion that separates the two.
    const attempted: string[] = [];
    const throwing = {
      call: async (tx: TransactionRequest) => {
        attempted.push(String(tx.to));
        throw new Error('provider must not be called for a long pool');
      },
    } as unknown as Provider;

    for (const name of ['wstETH-Long', 'WBTC-Long'] as const) {
      const info = await getFxCreditNote(name, throwing);
      expect(info.availability).to.equal('none-long-pool');
      expect(info.side).to.equal('long');
      expect(info.address).to.equal(undefined);
      expect(info.error).to.equal(undefined);
    }
    expect(attempted).to.deep.equal([]);
  });

  it('reads a short pool note and its mint authority', async () => {
    const info = await getFxCreditNote('stETH-Short', makeStubProvider());
    expect(info.availability).to.equal('present');
    expect(info.address).to.equal(CN_A);
    expect(info.symbol).to.equal('xx-CN');
    expect(info.decimals).to.equal(18n);
    expect(info.totalSupply).to.equal(1_000n);
    expect(info.mintAuthority).to.equal(HOLDER);
    // Redemption pays the pool's collateral (fxUSD), not the note's
    // denomination — measured against ShortPoolManager.redeemByCreditNote.
    expect(info.redeemsForToken).to.equal(FX_ADDRESSES.fxUSD);
  });

  it('does NOT report a failed creditNote() read as "no credit note"', async () => {
    const info = await getFxCreditNote(
      'stETH-Short',
      makeStubProvider({ notes: { [STETH_SHORT]: 'revert' } }),
    );
    expect(info.availability).to.equal('unreadable');
    expect(info.availability).to.not.equal('none-configured');
    expect(info.address).to.equal(undefined);
    expect(String(info.error)).to.contain('creditNote() failed');
  });

  it('separates a configured-zero note from an unreadable one', async () => {
    const info = await getFxCreditNote(
      'stETH-Short',
      makeStubProvider({ notes: { [STETH_SHORT]: ZeroAddress } }),
    );
    expect(info.availability).to.equal('none-configured');
    expect(info.error).to.equal(undefined);
  });

  it('does NOT report a note with an unanswering ERC-20 surface as present', async () => {
    const info = await getFxCreditNote(
      'stETH-Short',
      makeStubProvider({ failMetadata: new Set([CN_A]) }),
    );
    expect(info.availability).to.equal('unreadable');
    // The address was resolved, so it is still reported — but never as a
    // `present` entry with silently missing metadata.
    expect(info.address).to.equal(CN_A);
    expect(info.symbol).to.equal(undefined);
    expect(String(info.error)).to.contain('metadata read failed');
  });
});

describe('fx credit note reader — balances report', () => {
  it('reports a real zero as a holding, not as an omission', async () => {
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR],
      provider: makeStubProvider(),
      pools: ['stETH-Short'],
    });

    expect(report.complete).to.equal(true);
    expect(report.unreadable).to.deep.equal([]);
    expect(report.holdings.length).to.equal(1);
    expect(report.holdings[0].account).to.equal(EXECUTOR);
    expect(report.holdings[0].balance).to.equal(0n);
    expect(report.nonZero).to.deep.equal([]);
  });

  it('keeps an unreadable balance out of holdings instead of zeroing it', async () => {
    // The §9 crux. If a failed `balanceOf` were folded to `0n`, this report
    // would be indistinguishable from the previous test's — same holdings,
    // same empty `nonZero`, `complete: true` — and a caller would drop an
    // executor key on the strength of a read that never happened.
    const report = await getFxCreditNoteBalances({
      accounts: [HOLDER, EXECUTOR],
      provider: makeStubProvider({
        balances: { [`${CN_A}:${HOLDER}`]: 42n },
        failBalances: new Set([`${CN_A}:${EXECUTOR}`]),
      }),
      pools: ['stETH-Short'],
    });

    expect(report.complete).to.equal(false);
    expect(report.unreadableCount).to.equal(1);
    expect(report.unreadable[0].account).to.equal(EXECUTOR);
    expect(report.unreadable[0].reason).to.equal('balance-unreadable');

    // The executor appears nowhere in holdings — not even as a zero.
    expect(
      report.holdings.some(holding => holding.account === EXECUTOR),
    ).to.equal(false);
    expect(report.holdings.length).to.equal(1);
    expect(report.holdings[0].account).to.equal(HOLDER);
    expect(report.holdings[0].balance).to.equal(42n);
    expect(report.nonZero.length).to.equal(1);
  });

  it('files an unreadable note under the pool, and still reads the others', async () => {
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR],
      provider: makeStubProvider({
        notes: { [STETH_SHORT]: 'revert', [WBTC_SHORT]: CN_B },
      }),
      pools: ['stETH-Short', 'WBTC-Short'],
    });

    expect(report.complete).to.equal(false);
    expect(report.unreadable.length).to.equal(1);
    expect(report.unreadable[0].reason).to.equal('note-unreadable');
    expect(report.unreadable[0].poolName).to.equal('stETH-Short');
    expect(report.unreadable[0].account).to.equal(undefined);
    // One bad pool does not abort the sweep.
    expect(report.holdings.length).to.equal(1);
    expect(report.holdings[0].creditNote).to.equal(CN_B);
  });

  it('defaults to every known pool and files the long ones as absent', async () => {
    const calls: string[] = [];
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR],
      provider: makeStubProvider({ calls }),
    });

    expect(report.complete).to.equal(true);
    expect(report.absent.map(entry => entry.poolName).sort()).to.deep.equal([
      'WBTC-Long',
      'wstETH-Long',
    ]);
    expect(report.absent.every(entry => entry.side === 'long')).to.equal(true);
    expect(
      report.absent.every(entry => entry.availability === 'none-long-pool'),
    ).to.equal(true);
    expect(report.holdings.length).to.equal(2);
    // No network traffic was spent on the pools that structurally have none.
    expect(
      calls.some(
        entry =>
          entry.startsWith(poolAddress('wstETH-Long')) ||
          entry.startsWith(poolAddress('WBTC-Long')),
      ),
    ).to.equal(false);
  });

  it('assertFxCreditNoteReportComplete names the unread pair', async () => {
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR],
      provider: makeStubProvider({
        failBalances: new Set([`${CN_A}:${EXECUTOR}`]),
      }),
      pools: ['stETH-Short'],
    });

    expect(() => assertFxCreditNoteReportComplete(report)).to.throw(
      /stETH-Short\/0x1111111111111111111111111111111111111111 \(balance-unreadable\)/,
    );
  });

  it('assertFxCreditNoteReportComplete passes a clean report', async () => {
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR],
      provider: makeStubProvider(),
      pools: ['stETH-Short'],
    });
    expect(() => assertFxCreditNoteReportComplete(report)).to.not.throw();
  });
});

// ---------------------------------------------------------------------------
// Live mainnet. These pin the two facts that decide whether a redeem recipe is
// ever worth building: what the notes are, and who holds them.
// ---------------------------------------------------------------------------
describe('fx credit note reader — mainnet', function run() {
  this.timeout(90_000);

  const RPC =
    process.env.MAINNET_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
  let provider: JsonRpcProvider;

  before(() => {
    provider = new JsonRpcProvider(RPC);
  });

  after(() => {
    provider.destroy();
  });

  it('reads the two shipped short-pool credit notes', async () => {
    const steth = await getFxCreditNote('stETH-Short', provider);
    expect(steth.availability).to.equal('present');
    expect(steth.address).to.equal(
      getAddress('0x7c5350BaC0eB97F86A366Ee4F9619a560480F05A'),
    );
    expect(steth.symbol).to.equal('wstETH-CN');
    // The note tracks the short pool's DEBT token, not its collateral.
    expect(steth.decimals).to.equal(18n);
    expect(steth.redeemsForToken).to.equal(FX_ADDRESSES.fxUSD);
    // Mint/burn authority is the LONG manager, not the short one that hosts
    // the pool — measured: mint reverts 0x742c612c from the short manager.
    expect(steth.mintAuthority).to.equal(FX_ADDRESSES.fxPoolManager);
    expect(steth.mintAuthority).to.not.equal(FX_ADDRESSES.fxShortPoolManager);

    const wbtc = await getFxCreditNote('WBTC-Short', provider);
    expect(wbtc.availability).to.equal('present');
    expect(wbtc.address).to.equal(
      getAddress('0xB25a554033C59e33e48c5dc05A7192Fb1bbDdfc6'),
    );
    expect(wbtc.symbol).to.equal('WBTC-CN');
    expect(wbtc.decimals).to.equal(8n);
    expect(wbtc.mintAuthority).to.equal(FX_ADDRESSES.fxPoolManager);
  });

  it('holds the sole-holder invariant: 100% of supply sits with the minter', async () => {
    // This is the whole reason there is no redeem recipe. Across both notes'
    // entire history (deploy -> head, mints minus burns reconciled to
    // totalSupply) there are zero user-to-user transfers and zero Approvals:
    // the long PoolManager has always held every unit. If f(x) ever starts
    // distributing them, this fails and the redeem question reopens.
    //
    // Both legs read at one pinned block so a transfer landing mid-test
    // cannot turn a real invariant break into a rounding artefact, or hide one.
    const blockTag = await provider.getBlockNumber();

    for (const name of ['stETH-Short', 'WBTC-Short'] as const) {
      const info = await getFxCreditNote(name, provider);
      expect(info.availability).to.equal('present');
      const note = new Contract(
        info.address as string,
        abi.token.erc20 as InterfaceAbi,
        provider,
      );
      const [supply, minterBalance, shortManagerBalance] = (await Promise.all([
        note.totalSupply({ blockTag }),
        note.balanceOf(info.mintAuthority as string, { blockTag }),
        note.balanceOf(FX_ADDRESSES.fxShortPoolManager, { blockTag }),
      ])) as [bigint, bigint, bigint];

      expect(supply > 0n, `${name}: notes are outstanding`).to.equal(true);
      expect(
        minterBalance,
        `${name}: every outstanding credit note is held by the minter`,
      ).to.equal(supply);
      // Negative control: the manager that hosts the pool and emits `Operate`
      // is the obvious wrong guess, and holds none. Without this the equality
      // above could be read as "any f(x) contract holds the supply".
      expect(
        shortManagerBalance,
        `${name}: the short manager holds none of its own pool's notes`,
      ).to.equal(0n);
    }
  });

  it('reports an ephemeral-executor-shaped address as a real zero', async () => {
    const report = await getFxCreditNoteBalances({
      accounts: [EXECUTOR, FX_ADDRESSES.fxPoolManager],
      provider,
    });

    assertFxCreditNoteReportComplete(report);
    // 2 short pools x 2 accounts; the 2 long pools are `absent`.
    expect(report.holdings.length).to.equal(4);
    expect(report.absent.length).to.equal(2);

    const executorHoldings = report.holdings.filter(
      holding => holding.account === EXECUTOR,
    );
    expect(executorHoldings.length).to.equal(2);
    expect(executorHoldings.every(holding => holding.balance === 0n)).to.equal(
      true,
    );

    // Nothing but the long PoolManager is ever non-zero.
    expect(
      report.nonZero.every(
        holding => holding.account === FX_ADDRESSES.fxPoolManager,
      ),
    ).to.equal(true);
    expect(report.nonZero.length).to.equal(2);
  });
});
