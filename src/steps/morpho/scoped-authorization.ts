import { Step } from '../step';
import { MorphoBlueSetAuthorizationStep } from './blue-set-authorization-step';
import {
  resolveExecutorAddress,
  type EphemeralExecutor,
} from '../../utils/7702';

/**
 * Wrap steps that need Morpho Blue authorization so the grant lasts exactly as
 * long as the batch: `setAuthorization(true)` before them, `setAuthorization
 * (false)` after.
 *
 * **Why this exists.** A Morpho Blue authorization is the one residue in this
 * package that a failure cannot undo and a sweep cannot reach.
 * `isAuthorized[owner][authorized] = true` is not value and not balance, so the
 * shield epilogue has nothing to collect and re-running the recipe does not
 * clear it. Every other residue on a 7702 executor — ERC-20 dust, a position
 * NFT, native balance — is recoverable from the ephemeral account in a follow-up
 * transaction, because the wallet holds that key. Authority is not: it lives in
 * Morpho's storage, keyed on the executor, and only an explicit revoke removes
 * it. Left behind, it is standing permission over every position that account
 * holds, now and in future.
 *
 * The batch shape makes it work. Both 7702 paths run with
 * `requireSuccess = false`, which means the multicall CONTINUES past a failed
 * call rather than breaking — so the trailing revoke still executes when the
 * wrapped steps fail. That property is what turns "grant, fail, leak" into
 * "grant, fail, revoke".
 *
 * The revoke can itself fail, which would leave the grant standing; it is a
 * single storage write to Blue, so that requires Blue to be reverting outright.
 * `assertExecutorResidue` reports the surviving grant under `authority` if it
 * happens, rather than treating a swept executor as clean.
 *
 * **Not for durable delegation.** The retained-account and Bundler3 models want
 * a grant that outlives the batch; use {@link MorphoBlueSetAuthorizationStep} or
 * `MorphoBlueSetAuthorizationRecipe` directly for those, where the persistence
 * is the point rather than the leak. Use this wrapper whenever the grant is a
 * means to something else happening in the same batch.
 *
 * Costs one extra call and its gas. A recipe using this should size
 * `minGasLimit` for both writes; the floor is enforced in-contract as an
 * up-front `gasleft()` require over the whole batch.
 *
 * @param authorized the operator being granted access for the batch
 * @param steps the steps that need the authorization, in order
 */
export const withScopedMorphoBlueAuthorization = (
  authorized: EphemeralExecutor | string,
  steps: Step[],
): Step[] => {
  // Resolve once and hand the same string to both steps. Resolving twice would
  // validate twice and produce the same result today, but the grant and the
  // revoke MUST name the identical address — a revoke aimed anywhere else
  // leaves the grant standing while looking like it cleaned up.
  const operator = resolveExecutorAddress(
    authorized,
    'withScopedMorphoBlueAuthorization authorized',
  );
  return [
    new MorphoBlueSetAuthorizationStep(operator, true),
    ...steps,
    new MorphoBlueSetAuthorizationStep(operator, false),
  ];
};
