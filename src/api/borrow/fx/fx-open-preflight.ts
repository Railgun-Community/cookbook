import { Contract, type Provider } from 'ethers';
import {
  FX_POOL_RATIO_ABI,
  FX_PRICE_ORACLE_ABI,
  resolvePool,
  type FxMintPoolRef,
  type FxPoolSide,
} from '../../../steps/borrow/fx/fx-mint-util';
import {
  getFxDebtScalingFactor,
  getFxPool,
  getFxTopLevelCallGate,
  getNextFxPositionId,
} from './fx-position-reader';

const WAD = 10n ** 18n;

/**
 * Why a build should not proceed. `code` is stable enough to branch on; `detail`
 * is for a human.
 */
export type FxOpenBlocker = {
  readonly code:
    | 'top-level-call-gate'
    | 'debt-capacity'
    | 'debt-ratio'
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
const BASE_UNCHECKED = Object.freeze([
  // Requires simulating `operate()` with the collateral already at the
  // executor, which needs ERC-20 balance and allowance state overrides and so
  // per-token storage slots.
  'operate-simulation',
  // The pool can be paused or reconfigured between this read and the batch
  // landing. Nothing read here is a guarantee about the next block.
  'same-block-guarantee',
]);

/** Added when the caller supplies no collateral amount to check the ratio against. */
const UNCHECKED_RATIO = 'resulting-debt-ratio';

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
  /**
   * Collateral being supplied, in native `collateralToken` units. Supplying it
   * enables the debt-ratio check — the one that catches an open f(x) will
   * refuse on risk grounds rather than on capacity or permissions. Omit it and
   * `resulting-debt-ratio` appears in {@link FxOpenPreflight.unchecked}.
   */
  collateralAmount?: bigint;
}): Promise<FxOpenPreflight> {
  const { pool, targetDebt, provider, predictedPositionId, collateralAmount } =
    params;

  const blockers: FxOpenBlocker[] = [];
  const uncheckedList: string[] = [...BASE_UNCHECKED];

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

  // Debt ratio. Only reachable with a collateral amount to compute it from, and
  // only meaningful with the pool read that carries the raw/native conversion
  // terms.
  if (collateralAmount === undefined || collateralAmount <= 0n) {
    uncheckedList.push(UNCHECKED_RATIO);
  } else if (poolResult.status !== 'fulfilled') {
    // The pool read already produced an `unreadable` blocker above; record that
    // the ratio went unchecked too rather than letting its absence read as a pass.
    uncheckedList.push(UNCHECKED_RATIO);
  } else {
    const ratioCheck = await checkFxOpenDebtRatio({
      pool,
      provider,
      collateralAmount,
      targetDebt,
      totalRawColls: poolResult.value.totalRawColls,
      collateralBalance: poolResult.value.collateralBalance,
      side: poolResult.value.side,
    });
    if (ratioCheck.blocker !== undefined) {
      blockers.push(ratioCheck.blocker);
    }
    if (!ratioCheck.checked) {
      uncheckedList.push(UNCHECKED_RATIO);
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
      unchecked: uncheckedList,
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
    unchecked: uncheckedList,
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

/**
 * Project the debt ratio an open would land at, and compare it to the pool's
 * ceiling.
 *
 * **The formula is measured, not inferred.** `rawDebts * 1e36 / (rawColls *
 * anchorPrice)` reproduces `Pool.getPositionDebtRatio` EXACTLY — zero
 * difference, on four live mainnet positions spanning 26% to 64%. The oracle's
 * `minPrice` and `maxPrice` both miss by ~1e15, so the anchor is the one f(x)
 * prices positions with and substituting either of the others would put this
 * check wrong by a fraction of a percent in an unpredictable direction.
 *
 * Both figures must be RAW, which is where this could go wrong quietly. The
 * caller passes native units, and raw and native diverge on the short pools —
 * the same trap that produced a shipped bug at the close/repay boundary. The
 * collateral conversion inverts the pool-level ratio `getFxPosition` uses
 * (`native = raw * collateralBalance / totalRawColls`), and the debt conversion
 * uses the manager's own scaling factor.
 *
 * Returns `checked: false` rather than a pass when any input could not be read.
 * A ratio that could not be computed is not a ratio that is fine.
 */
async function checkFxOpenDebtRatio(args: {
  pool: FxMintPoolRef;
  provider: Provider;
  collateralAmount: bigint;
  targetDebt: bigint;
  totalRawColls: bigint;
  collateralBalance: bigint;
  side: FxPoolSide;
}): Promise<{ checked: boolean; blocker?: FxOpenBlocker }> {
  const {
    pool,
    provider,
    collateralAmount,
    targetDebt,
    totalRawColls,
    collateralBalance,
    side,
  } = args;

  const resolved = resolvePool(pool);
  const poolContract = new Contract(
    resolved.address,
    FX_POOL_RATIO_ABI as unknown as string[],
    provider,
  );

  let maxRatio: bigint;
  let anchorPrice: bigint;
  let debtScalingFactor: bigint;
  try {
    const [range, oracleAddress, scaling] = await Promise.all([
      poolContract.getDebtRatioRange() as Promise<[bigint, bigint]>,
      poolContract.priceOracle() as Promise<string>,
      // Long pools report debt NATIVELY, so there is no `tokenRates` entry to
      // find and the factor is the identity. `getFxDebtScalingFactor` now
      // returns exactly that for a long, so this branch is an optimisation
      // (it skips two RPC reads) rather than a workaround — it used to be
      // load-bearing, because the helper threw and a throw inside this
      // `Promise.all` would have reported every long-pool check as unchecked.
      side === 'short'
        ? getFxDebtScalingFactor(pool, provider)
        : Promise.resolve(WAD),
    ]);
    maxRatio = range[1];
    debtScalingFactor = scaling;
    const oracle = new Contract(
      oracleAddress,
      FX_PRICE_ORACLE_ABI as unknown as string[],
      provider,
    );
    const price = (await oracle.getPrice()) as [bigint, bigint, bigint];
    anchorPrice = price[0];
  } catch {
    // Unreadable, not fine. The caller sees `resulting-debt-ratio` in
    // `unchecked` and can decide whether to proceed.
    return { checked: false };
  }

  if (
    collateralBalance <= 0n ||
    totalRawColls <= 0n ||
    anchorPrice <= 0n ||
    maxRatio <= 0n
  ) {
    // An empty pool has no ratio to project against, and a zero price would
    // divide by zero. Neither is a pass.
    return { checked: false };
  }

  // native -> raw, inverting `getFxPosition`'s conversion.
  const rawColls = (collateralAmount * totalRawColls) / collateralBalance;
  // native -> raw for debt: the manager's scaling factor is 1e18-composed, so
  // multiplying and dividing by WAD keeps the units honest. It is identity on
  // the long pools and 1e10 on `WBTC-Short`.
  const rawDebts = (targetDebt * debtScalingFactor) / WAD;

  if (rawColls <= 0n) {
    return { checked: false };
  }

  const projectedRatio = (rawDebts * WAD * WAD) / (rawColls * anchorPrice);
  if (projectedRatio > maxRatio) {
    return {
      checked: true,
      blocker: {
        code: 'debt-ratio',
        detail:
          `the open would land at a debt ratio of ${projectedRatio} ` +
          `(${(Number(projectedRatio) / 1e16).toFixed(
            2,
          )}%), above the pool's ` +
          `maximum of ${maxRatio} ` +
          `(${(Number(maxRatio) / 1e16).toFixed(2)}%). f(x) refuses it. ` +
          `Borrow less against this collateral, or supply more collateral. ` +
          `Priced at ${anchorPrice} per collateral unit from the pool's own ` +
          `oracle — the same anchor price f(x) uses, so this is the figure the ` +
          `protocol will apply, not an approximation of it.`,
      },
    };
  }

  return { checked: true };
}
