import {
  Contract,
  ZeroAddress,
  getAddress,
  type InterfaceAbi,
  type Provider,
} from 'ethers';
import { abi } from '../../../abi/abi';
import {
  KNOWN_POOLS,
  resolvePool,
  type Address,
  type FxMintPoolName,
  type FxMintPoolRef,
  type FxPoolSide,
} from '../../../steps/borrow/fx/fx-mint-util';

// =============================================================================
// f(x) credit notes — what they are, and why this file is a reader and nothing
// else.
//
// ## What a credit note is
//
// A credit note is a plain ERC-20, one per **short** pool, minted 1:1 against
// that pool's outstanding debt. Measured on mainnet 2026-08-05:
//
//   stETH-Short 0x25707b9e…1876  .creditNote() -> 0x7c5350Ba…F05A
//                                 "wstETH Credit Note" / wstETH-CN / 18 dp
//   WBTC-Short  0xa0cc8162…a5b0  .creditNote() -> 0xB25a5540…dfc6
//                                 "WBTC Credit Note"  / WBTC-CN   /  8 dp
//
// The denomination follows the short pool's **debt** token (the volatile asset
// the short borrows), not its collateral. Both long pools have no
// `creditNote()` getter at all — the call reverts with empty data — which is
// why this reader never issues it for a long pool.
//
// The supply is the pool's debt. `cn.totalSupply()` equalled
// `pool.getTotalRawDebts()` **exactly** at all nine blocks sampled across the
// stETH-Short pool's entire life (22,990,131 → 25,688,855). WBTC-CN carries
// the same relation modulo the 10^10 raw↔native rescale, so it drifts by
// rounding rather than matching bit for bit.
//
// ## Nobody outside f(x) has ever held one
//
// This is the finding that decides the shape of this file. Every `Transfer`
// the two credit notes have ever emitted was pulled and reconciled
// (deploy block → head, no gaps — mints minus burns equals `totalSupply()`
// exactly on both tokens, which is what proves the scan complete):
//
//   wstETH-CN  1,625 transfers = 563 mints + 1,062 burns +   0 plain transfers
//   WBTC-CN    1,234 transfers = 282 mints +   952 burns +   0 plain transfers
//
// Every mint went **to** `PoolManager` 0x250893CA…CD24 — the *long* manager —
// and every burn came **from** it. Zero user-to-user transfers. Zero `Approval`
// events, ever, on either token. The current holder set is exactly
// `{ long PoolManager }`, holding 100% of supply.
//
// That is not an accident of low usage; it is the design. `mint`/`burn` on the
// note revert for every caller except `cn.poolManager()` (measured: reverts
// `0x742c612c` from an EOA *and* from the ShortPoolManager; succeeds only from
// the long manager). Opening a short position mints the note to the long
// manager and closing burns it — verified by decoding
// `ShortPoolManager.Operate(address indexed pool, uint256 indexed positionId,
// int256 dColl, int256 dDebt, uint256 fees)` against the note's `Transfer` in
// the same transaction: mint amount == +dDebt, burn amount == -dDebt.
//
// **So the shipped short-pool recipes do cause credit notes to be minted and
// burned, and do not strand any**: the recipient is the long PoolManager, never
// `msg.sender`, so neither the ephemeral 7702 executor nor the RAILGUN proxy
// ever receives one. There is nothing for `executor-residue` to sweep here.
//
// ## Why there is no redeem recipe
//
// The redemption entry point exists and works, but only for a holder — and
// there are none. Verified by `eth_call` with state overrides (balance +
// allowance faked onto an arbitrary EOA, three independent endpoints agreeing):
//
//   ShortPoolManager.redeemByCreditNote(address pool,
//                                       uint256 amountCreditNote,
//                                       uint256 minDstToken)
//     returns (uint256 collateralOut)      // selector 0x3016a581
//
// It pulls `amountCreditNote` from `msg.sender` via `transferFrom` (a caller
// with no allowance gets `ERC20InsufficientAllowance(shortPoolManager, 0, amt)`
// naming the manager as spender), and pays out the short pool's **collateral**
// (fxUSD) priced off the debt-token oracle less a few bps:
//
//   0.01 wstETH-CN -> 23.286185551459558247 fxUSD (oracle 23.2929, -2.9 bp)
//   0.001 WBTC-CN  -> 64.341401466855577444 fxUSD (oracle 64.3708, -4.6 bp)
//
// `minDstToken` is a floor on that payout: `out` passes, `out + 1` reverts
// `ErrorInsufficientRedeemedCollateral()` (0x794c8858). A pool that is not
// registered on the short manager reverts `ErrorPoolNotRegistered()`
// (0xaaaf1ba7), which is also how the first argument is confirmed to be the
// pool and not a receiver. The pool-level twin
// `Pool.redeemByCreditNote(uint256)` (0xc4617b6e) reverts
// `ErrorCallerNotPoolManager()` (0x14f8457e) for anyone but the manager.
//
// Building a recipe on top of that would be building for a holder that cannot
// exist. Worse, under `RelayAdapt7702` — which hardcodes `requireSuccess =
// false` — a redeem leg that reverts because the batch holds no credit notes
// mines with status 1 and looks like a success. So this file stops at reads.
//
// ## What this reader is for
//
// One question, answered without ambiguity: *does this address hold a credit
// note?* If f(x) ever changes distribution — governance hands notes out, a new
// short manager mints to `msg.sender`, a redeem path opens to users — the
// answer flips silently and nothing else in the cookbook would notice. The
// balances report is the check, and its accompanying test pins the sole-holder
// invariant so that the day it stops holding, a test fails.
//
// Per §9 the report never collapses "holds nothing" into "could not look": a
// successful zero read is a `holdings` entry with `balance === 0n`, a failed
// read is an `unreadable` entry, and `complete` is false when any read failed.
// =============================================================================

/**
 * `Pool.creditNote()` — present on f(x) v2.1 **short** pools only.
 *
 * Kept here rather than in `FX_POOL_ABI` because it is a short-pool-only
 * getter and every other consumer of `FX_POOL_ABI` treats that ABI as the
 * surface both sides answer.
 */
export const FX_SHORT_POOL_CREDIT_NOTE_ABI = [
  {
    inputs: [],
    name: 'creditNote',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * `CreditNote.poolManager()` — the sole address permitted to mint or burn.
 * Reads as the *long* `PoolManager` on both shipped notes, not the short
 * manager that hosts the pool.
 */
export const FX_CREDIT_NOTE_ABI = [
  {
    inputs: [],
    name: 'poolManager',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Whether a pool has a credit note, and if not, whether that is the structural
 * answer or a failure to look.
 *
 * `'none-long-pool'` is asserted **without a call**. `creditNote()` does not
 * exist on a long pool, so the read would revert — and a revert is not
 * distinguishable from a dead RPC at this layer. The registry already knows the
 * side, so the reader answers from the side rather than from an error.
 */
export type FxCreditNoteAvailability =
  /** `creditNote()` returned a contract, and its ERC-20 surface answered. */
  | 'present'
  /** Long pool. No `creditNote()` getter exists; nothing was read. */
  | 'none-long-pool'
  /** Short pool whose `creditNote()` returned `address(0)`. */
  | 'none-configured'
  /**
   * A short pool whose `creditNote()` — or the note's own metadata — could not
   * be read. NOT "has none": an unreadable pool is never reported as empty.
   */
  | 'unreadable';

export type FxCreditNoteInfo = {
  pool: { address: Address; name?: FxMintPoolName };
  side: FxPoolSide;
  availability: FxCreditNoteAvailability;
  /** The note's ERC-20 address. Set only when `availability === 'present'`. */
  address?: Address;
  symbol?: string;
  /** Native decimals; tracks the short pool's debt token (18 / 8 measured). */
  decimals?: bigint;
  totalSupply?: bigint;
  /** `creditNote.poolManager()` — the only minter and burner. */
  mintAuthority?: Address;
  /**
   * The token `ShortPoolManager.redeemByCreditNote` pays out — the pool's
   * collateral. Registry-derived, not read; present only alongside a note.
   */
  redeemsForToken?: Address;
  /** Message from the failed read. Set only for `'unreadable'`. */
  error?: string;
};

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Resolve one pool's credit note.
 *
 * Long pools short-circuit to `'none-long-pool'` without touching the network;
 * that is the difference between knowing a pool has no note and merely failing
 * to prove it has one. The short-circuit requires the side to be KNOWN — a
 * custom ref that omits `side` is asked rather than assumed, because
 * `resolvePool` would default it to long and turn an unknown into a confident
 * negative.
 */
export async function getFxCreditNote(
  poolRef: FxMintPoolRef,
  provider: Provider,
): Promise<FxCreditNoteInfo> {
  const resolved = resolvePool(poolRef);
  const pool = {
    address: resolved.address,
    ...(typeof poolRef === 'string' ? { name: poolRef } : {}),
  };

  // Only short-circuit when the side is KNOWN, not merely defaulted.
  //
  // `resolvePool` fills a custom ref's side with `ref.side ?? 'long'`, so a
  // custom SHORT pool that omits the field resolves as long and would take this
  // branch — returning `'none-long-pool'`, the strongest negative in the union,
  // documented as "nothing was read, and that is correct". It would be a
  // confident false clean, and precisely in this reader's stated use case:
  // sweeping an ephemeral executor against a short pool not yet in
  // `KNOWN_POOLS`.
  //
  // That is the same §9 failure this module defends against elsewhere, one
  // level displaced: it refuses to collapse a read FAILURE into "none", but was
  // collapsing a DEFAULTED FIELD into "none". A named pool's side is
  // authoritative, and an explicit `side` on a custom ref is too; anything else
  // gets asked rather than assumed, and a revert answers it.
  const sideIsKnown =
    typeof poolRef === 'string' || poolRef.side !== undefined;
  if (sideIsKnown && resolved.side !== 'short') {
    return { pool, side: resolved.side, availability: 'none-long-pool' };
  }

  let noteAddress: Address;
  try {
    const poolContract = new Contract(
      resolved.address,
      FX_SHORT_POOL_CREDIT_NOTE_ABI as unknown as InterfaceAbi,
      provider,
    );
    noteAddress = getAddress(
      String(await poolContract.creditNote()),
    ) as Address;
  } catch (cause) {
    return {
      pool,
      side: resolved.side,
      availability: 'unreadable',
      error: `creditNote() failed on pool ${resolved.address}: ${errorMessage(
        cause,
      )}`,
    };
  }

  if (noteAddress === ZeroAddress) {
    return { pool, side: resolved.side, availability: 'none-configured' };
  }

  try {
    const erc20 = new Contract(
      noteAddress,
      abi.token.erc20 as InterfaceAbi,
      provider,
    );
    const note = new Contract(
      noteAddress,
      FX_CREDIT_NOTE_ABI as unknown as InterfaceAbi,
      provider,
    );
    const [symbol, decimals, totalSupply, mintAuthority] = await Promise.all([
      erc20.symbol() as Promise<string>,
      erc20.decimals() as Promise<bigint>,
      erc20.totalSupply() as Promise<bigint>,
      note.poolManager() as Promise<string>,
    ]);
    return {
      pool,
      side: resolved.side,
      availability: 'present',
      address: noteAddress,
      symbol,
      decimals,
      totalSupply,
      mintAuthority: getAddress(String(mintAuthority)) as Address,
      redeemsForToken: resolved.collateralToken,
    };
  } catch (cause) {
    // A note whose own ERC-20 surface will not answer cannot be reasoned
    // about, so this is `unreadable` rather than a `present` entry with holes.
    return {
      pool,
      side: resolved.side,
      availability: 'unreadable',
      address: noteAddress,
      error: `credit note ${noteAddress} metadata read failed: ${errorMessage(
        cause,
      )}`,
    };
  }
}

/** One successfully read `(pool, account)` balance. Zero is a real answer. */
export type FxCreditNoteHolding = {
  pool: { address: Address; name?: FxMintPoolName };
  creditNote: Address;
  symbol?: string;
  decimals?: bigint;
  account: Address;
  balance: bigint;
  /** Collateral token a redemption of this note pays out. */
  redeemsForToken: Address;
};

/** A pool that has no credit note, and why — never mixed in with a zero. */
export type FxCreditNoteAbsence = {
  pool: Address;
  poolName?: FxMintPoolName;
  side: FxPoolSide;
  availability: 'none-long-pool' | 'none-configured';
};

export type FxUnreadableCreditNote = {
  pool: Address;
  poolName?: FxMintPoolName;
  /** Absent when the note itself, not a particular balance, was unreadable. */
  account?: Address;
  reason: 'note-unreadable' | 'balance-unreadable';
  error: string;
};

export type FxCreditNoteReport = {
  /** Every `(pool, account)` pair read successfully — **including zeros**. */
  holdings: readonly FxCreditNoteHolding[];
  /** The subset with a non-zero balance. Empty is the expected answer today. */
  nonZero: readonly FxCreditNoteHolding[];
  absent: readonly FxCreditNoteAbsence[];
  unreadable: readonly FxUnreadableCreditNote[];
  unreadableCount: number;
  /** `unreadable.length === 0`. False means "do not read `nonZero` as final". */
  complete: boolean;
};

/**
 * Read credit-note balances for a set of accounts across a set of pools.
 *
 * Defaults to every pool in `KNOWN_POOLS`, which is the useful default for the
 * question this answers — the long pools cost nothing (no call is issued) and
 * are reported in `absent`, so a caller sweeping an ephemeral executor does not
 * have to know which side carries notes.
 *
 * A failed `balanceOf` produces an `unreadable` entry and **no** `holdings`
 * entry. Reporting it as `0n` would be indistinguishable from a real zero,
 * which is the exact §9 failure this reader exists to avoid.
 */
export async function getFxCreditNoteBalances(params: {
  accounts: readonly string[];
  provider: Provider;
  pools?: readonly FxMintPoolRef[];
}): Promise<FxCreditNoteReport> {
  const { accounts, provider } = params;
  const pools = params.pools ?? KNOWN_POOLS.map(entry => entry.name);
  const checkedAccounts = accounts.map(
    account => getAddress(account) as Address,
  );

  const holdings: FxCreditNoteHolding[] = [];
  const absent: FxCreditNoteAbsence[] = [];
  const unreadable: FxUnreadableCreditNote[] = [];

  for (const poolRef of pools) {
    const info = await getFxCreditNote(poolRef, provider);

    if (info.availability === 'unreadable') {
      unreadable.push({
        pool: info.pool.address,
        ...(info.pool.name === undefined ? {} : { poolName: info.pool.name }),
        reason: 'note-unreadable',
        error: info.error ?? 'unknown read failure',
      });
      continue;
    }

    if (info.availability !== 'present') {
      absent.push({
        pool: info.pool.address,
        ...(info.pool.name === undefined ? {} : { poolName: info.pool.name }),
        side: info.side,
        availability: info.availability,
      });
      continue;
    }

    // Non-null by construction: `'present'` is only returned with all four set.
    const noteAddress = info.address as Address;
    const erc20 = new Contract(
      noteAddress,
      abi.token.erc20 as InterfaceAbi,
      provider,
    );

    for (const account of checkedAccounts) {
      try {
        const balance = (await erc20.balanceOf(account)) as bigint;
        holdings.push({
          pool: info.pool,
          creditNote: noteAddress,
          ...(info.symbol === undefined ? {} : { symbol: info.symbol }),
          ...(info.decimals === undefined ? {} : { decimals: info.decimals }),
          account,
          balance,
          redeemsForToken: info.redeemsForToken as Address,
        });
      } catch (cause) {
        unreadable.push({
          pool: info.pool.address,
          ...(info.pool.name === undefined ? {} : { poolName: info.pool.name }),
          account,
          reason: 'balance-unreadable',
          error: `balanceOf(${account}) failed on credit note ${noteAddress}: ${errorMessage(
            cause,
          )}`,
        });
      }
    }
  }

  return {
    holdings,
    nonZero: holdings.filter(holding => holding.balance > 0n),
    absent,
    unreadable,
    unreadableCount: unreadable.length,
    complete: unreadable.length === 0,
  };
}

/**
 * Throw unless every requested read landed.
 *
 * For a caller deciding "the executor is clean, drop the key", `complete` is
 * the only thing that makes `nonZero: []` mean anything.
 */
export const assertFxCreditNoteReportComplete = (
  report: FxCreditNoteReport,
): void => {
  if (report.complete) {
    return;
  }
  const details = report.unreadable
    .map(
      entry =>
        `${entry.poolName ?? entry.pool}${
          entry.account === undefined ? '' : `/${entry.account}`
        } (${entry.reason})`,
    )
    .join(', ');
  throw new Error(
    `fx credit note report incomplete: ${report.unreadableCount} unreadable read(s) — ${details}. ` +
      'A zero holding cannot be distinguished from an unread one; re-read before treating the account as clean.',
  );
};
