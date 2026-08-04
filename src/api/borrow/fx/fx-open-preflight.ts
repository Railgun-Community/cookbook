import type { Provider } from 'ethers';
import type { FxMintPoolRef } from '../../../steps/borrow/fx/fx-mint-util';
import {
  getFxPool,
  getFxTopLevelCallGate,
  getNextFxPositionId,
} from './fx-position-reader';

/**
 * Why a build should not proceed. `code` is stable enough to branch on; `detail`
 * is for a human.
 */
export type FxOpenBlocker = {
  readonly code:
    | 'top-level-call-gate'
    | 'debt-capacity'
    | 'position-id-stale'
    | 'unreadable';
  readonly detail: string;
};

export type FxOpenPreflight = {
  /** The id `operate()` will mint, read at `checkedAtBlock`. */
  readonly predictedPositionId: bigint;
  /** True only when `blockers` is empty. Never true when a read failed. */
  readonly ok: boolean;
  readonly blockers: readonly FxOpenBlocker[];
  /**
   * Checks this preflight did NOT perform, named. Present even when `ok` is
   * true — a caller must be able to tell "checked and fine" from "not checked".
   */
  readonly unchecked: readonly string[];
  /** The block every read above was taken at. */
  readonly checkedAtBlock: number;
};

/** Named so the omission is legible at the call site rather than implied. */
const UNCHECKED = Object.freeze([
  // Would need a collateral price. f(x) exposes debt ratio only for an
  // EXISTING position (`getPositionDebtRatio`), and there is no oracle read in
  // this package to price a hypothetical one. This is the largest gap: an open
  // that lands above the rebalance threshold still passes this preflight.
  'resulting-debt-ratio',
  // Requires simulating `operate()` with the collateral already at the
  // executor, which needs ERC-20 balance and allowance state overrides and so
  // per-token storage slots.
  'operate-simulation',
  // The pool can be paused or reconfigured between this read and the batch
  // landing. Nothing read here is a guarantee about the next block.
  'same-block-guarantee',
]);

/**
 * Check, before building an f(x) open, the conditions that would otherwise make
 * the batch fail in the one place a 7702 failure is expensive.
 *
 * **Why an open specifically.** `FxMintOpenPositionStep` declares the position
 * NFT at `predictedPositionId` in `outputNFTs`, and the shield epilogue calls
 * `approve(railgun, id)` on every NFT request BEFORE any ERC-20 work. If
 * `operate()` did not mint that exact id — because it failed, or because another
 * opener took the id first — the approve reverts and takes the WHOLE shield with
 * it. The collateral that would otherwise have swept back is left public at the
 * ephemeral account.
 *
 * That residue is recoverable: the wallet holds the ephemeral key and can
 * collect it in a follow-up transaction. What is not recoverable is the privacy
 * — the unshield is now publicly associated with that address, permanently. So
 * the cost of a failed open is paid in linkability and an extra transaction, and
 * this preflight exists to avoid paying it rather than to avert a loss.
 *
 * It cannot be made airtight from the cookbook. The shield request list is
 * static, fixed when the proof is built, so it cannot be made conditional on
 * what `operate()` actually did; and `requireSuccess = false` means the batch
 * mines successfully either way. This narrows the window and names what it does
 * not cover — see {@link FxOpenPreflight.unchecked}.
 *
 * **Use it as late as possible.** The id it returns is only valid until someone
 * else opens on the same pool. Read, build, and submit together; do not cache.
 *
 * Costs three or four `eth_call`s, all pinned to one block so the id and the
 * capacity figures cannot disagree with each other.
 *
 * @param predictedPositionId an id the caller read earlier. Supplying it turns
 * the race into a detected `position-id-stale` blocker instead of a reverted
 * shield.
 */
export async function preflightFxOpen(params: {
  pool: FxMintPoolRef;
  targetDebt: bigint;
  provider: Provider;
  predictedPositionId?: bigint;
}): Promise<FxOpenPreflight> {
  const { pool, targetDebt, provider, predictedPositionId } = params;

  const blockers: FxOpenBlocker[] = [];

  // Read together so a slow call cannot straddle a block boundary and pair a
  // fresh id with stale capacity. The block number is settled alongside the
  // rest rather than awaited first: an unreachable provider must come back as
  // an `unreadable` blocker, not as a thrown error — a caller that wrapped this
  // in a try/catch and carried on would be doing exactly what the whole
  // never-map-an-error-to-ok discipline is meant to prevent.
  const [blockResult, gateResult, poolResult, nextIdResult] =
    await Promise.allSettled([
      provider.getBlockNumber(),
      getFxTopLevelCallGate(pool, provider),
      getFxPool(pool, provider),
      getNextFxPositionId(pool, provider),
    ]);

  // -1 is never a real block, so a caller cannot mistake it for a pinned read.
  const checkedAtBlock =
    blockResult.status === 'fulfilled' ? blockResult.value : -1;
  if (blockResult.status === 'rejected') {
    blockers.push({
      code: 'unreadable',
      detail: `could not read the current block: ${String(blockResult.reason)}`,
    });
  }

  // An unreadable check is NOT a passing check. Reporting `ok: true` here would
  // be the exact error the position readers are careful to avoid: mapping a
  // transport failure onto "nothing wrong".
  if (gateResult.status === 'rejected') {
    blockers.push({
      code: 'unreadable',
      detail: `could not read the top-level-call gate: ${String(
        gateResult.reason,
      )}`,
    });
  } else if (gateResult.value.blocksOperate) {
    blockers.push({
      code: 'top-level-call-gate',
      detail:
        `PoolManager.whitelist() is ${gateResult.value.whitelist} ` +
        `(${gateResult.value.status}). A 7702 executor trips both trigger ` +
        "conditions of f(x)'s onlyTopLevelCall — it has code, and " +
        'msg.sender != tx.origin — so operate() would revert with ' +
        'ErrorTopLevelCall. Note this verdict is deliberately conservative: it ' +
        'is also true when the gate is enforced but the checker could not be ' +
        'read, which is the right direction to fail in.',
    });
  }

  if (poolResult.status === 'rejected') {
    blockers.push({
      code: 'unreadable',
      detail: `could not read pool capacity: ${String(poolResult.reason)}`,
    });
  } else {
    const headroom =
      poolResult.value.debtCapacity - poolResult.value.debtBalance;
    if (targetDebt > headroom) {
      blockers.push({
        code: 'debt-capacity',
        detail:
          `targetDebt ${targetDebt} exceeds the pool's remaining debt capacity ` +
          `${headroom} (capacity ${poolResult.value.debtCapacity}, outstanding ` +
          `${poolResult.value.debtBalance}).`,
      });
    }
  }

  if (nextIdResult.status === 'rejected') {
    return {
      predictedPositionId: predictedPositionId ?? 0n,
      ok: false,
      blockers: [
        ...blockers,
        {
          code: 'unreadable',
          detail: `could not read getNextPositionId(): ${String(
            nextIdResult.reason,
          )}`,
        },
      ],
      unchecked: UNCHECKED,
      checkedAtBlock,
    };
  }

  const nextId = nextIdResult.value;
  if (predictedPositionId !== undefined && predictedPositionId !== nextId) {
    blockers.push({
      code: 'position-id-stale',
      detail:
        `the id supplied (${predictedPositionId}) is no longer the one ` +
        `operate() will mint (${nextId}) — another opener took it. Rebuild ` +
        'with the current id; a batch built on the stale one mints a position ' +
        'at a different id and then reverts the whole shield trying to ' +
        'approve the one it declared.',
    });
  }

  return {
    predictedPositionId: nextId,
    ok: blockers.length === 0,
    blockers,
    unchecked: UNCHECKED,
    checkedAtBlock,
  };
}

/**
 * {@link preflightFxOpen}, raising instead of reporting. For callers that would
 * only ever throw on a blocker anyway.
 */
export async function assertFxOpenViable(params: {
  pool: FxMintPoolRef;
  targetDebt: bigint;
  provider: Provider;
  predictedPositionId?: bigint;
}): Promise<FxOpenPreflight> {
  const preflight = await preflightFxOpen(params);
  if (!preflight.ok) {
    throw new Error(
      `f(x) open preflight failed at block ${preflight.checkedAtBlock}: ` +
        preflight.blockers
          .map(blocker => `[${blocker.code}] ${blocker.detail}`)
          .join(' | '),
    );
  }
  return preflight;
}
