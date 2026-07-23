import { RecipeERC20AmountRecipient, RecipeERC20Info } from '../../models/export-models';
import { EphemeralExecutor, resolveExecutorAddress } from './ephemeral-executor';

/**
 * Non-atomic, shield-only 7702 cross-contract flow — design contract.
 *
 * The legacy relay-adapt flow is atomic: unshield → cross-contract calls →
 * re-shield, all inside one transaction, with the shared relay-adapt contract
 * holding funds only for the duration of the batch.
 *
 * Under 7702 the executing identity is an ephemeral EOA (see
 * {@link EphemeralExecutor}). Because that account persists between
 * transactions, a multi-leg DeFi interaction no longer has to be atomic:
 *
 *   1. batch A (execute): funds arrive on / positions are opened by the
 *      ephemeral EOA. Nothing is necessarily shielded yet.
 *   2. batch B (execute, possibly much later): further calls act on the assets
 *      or position the EOA still holds, then the fungible results are shielded
 *      back into RAILGUN.
 *
 * Two invariants this module exists to protect:
 *
 *   - Identity continuity. Every leg that references the position/holder
 *     (`receiver`, `onBehalf`, self-call target) MUST resolve to the *same*
 *     ephemeral EOA. For un-tokenized positions (Morpho Blue) the executor
 *     address is the only handle to the position; a mismatched or stale address
 *     silently points at an empty position and can strand collateral.
 *
 *   - No misroute to relay-adapt. Funds must never be routed to the shared
 *     relay-adapt contract as a "recipient"; that would mix an individual
 *     user's assets into shared custody. Always thread the executor.
 *
 * Prefer reusing {@link TransferERC20Step} for a concrete external transfer;
 * this module intentionally ships helpers + the contract doc rather than a new
 * step, to keep the surface minimal.
 */

/**
 * Build a spent-amount record whose recipient is the resolved ephemeral
 * executor address. Use when a step emits an output that is conceptually
 * "delivered to the executing account" and you want the recipient label to be
 * the validated executor rather than a free-form string.
 */
export const spentToExecutor = (
  erc20Info: RecipeERC20Info,
  amount: bigint,
  executor: EphemeralExecutor | string,
  context = 'route-to-executor',
): RecipeERC20AmountRecipient => {
  return {
    tokenAddress: erc20Info.tokenAddress,
    decimals: erc20Info.decimals,
    amount,
    recipient: resolveExecutorAddress(executor, context),
  };
};
