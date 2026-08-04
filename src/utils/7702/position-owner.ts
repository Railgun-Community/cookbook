import { getAddress } from 'ethers';
import { assertValidRecipientAddress } from '../address';
import { EphemeralExecutor, isRelayAdaptAddress } from './ephemeral-executor';

/**
 * The account that **holds** an address-bound position.
 *
 * Two roles exist in every address-bound DeFi write, and under EIP-7702 they
 * are genuinely different accounts:
 *
 * | role | Morpho Blue name | what it is |
 * |---|---|---|
 * | owner | `onBehalf` | the durable account the position is booked against |
 * | receiver | `receiver` | the account this batch runs as, and shields from |
 *
 * They collapse in the ordinary self-custody case — one ephemeral executor
 * opens a position, reuses itself across later batches, and closes it. That
 * case stays the default. It is no longer the only expressible one: an
 * {@link EphemeralExecutor} that a durable owner has authorised can borrow
 * against, or unwind, the owner's position and shield the proceeds itself.
 *
 * ## Why this is a plain input union and not a second brand
 *
 * A branded `PositionOwner` object was considered and rejected. Every 7702
 * input in this package accepts `EphemeralExecutor | string`, because callers
 * hold addresses; a second brand would have to accept `| string` too, and
 * `Brand | string` is mutually assignable with `EphemeralExecutor | string`, so
 * TypeScript would catch none of the transposition it was introduced to
 * prevent. The relation actually worth enforcing — *every executor is a legal
 * owner of its own position; not every owner is a legal executor* — is one-way,
 * and a structural brand cannot express one-way assignability once `string` is
 * in the union. The result would be ceremony with no checking, which gets cast
 * away at the first awkward call site.
 *
 * What guards the distinction instead, in descending order of strength:
 *
 *   1. **Named, individually-required fields.** Every builder takes `owner` and
 *      `receiver` as separate keys of an options object. Transposing them is
 *      then a deliberate act, not a positional slip.
 *   2. **Two validators with different policies.**
 *      {@link resolvePositionOwnerAddress} for writes (this file) and
 *      {@link resolvePositionOwnerAddressForRead} for reads — see below; the
 *      relay-adapt rule genuinely differs between them.
 *   3. **A runtime authorization preflight.** When owner ≠ receiver the chain
 *      requires `isAuthorized[owner][receiver]`, and a missing authorization is
 *      otherwise invisible: `RelayAdapt7702` runs with `requireSuccess=false`,
 *      so the batch mines with status 1 having done nothing.
 *      `MorphoBlueAPI.assertAuthorized` turns that into a build-time error.
 */
export type PositionOwner = EphemeralExecutor | string;

/**
 * Validate a position owner for a **write** — a `supplyCollateral`, `borrow`,
 * `repay` or `withdrawCollateral` whose `onBehalf` is about to be baked into
 * call data.
 *
 * Same policy as {@link resolveExecutorAddress}, different diagnosis: a
 * relay-adapt owner is rejected because booking a position against the shared
 * relay-adapt contract puts an individual user's position into shared custody,
 * with no key able to unwind it.
 */
export const resolvePositionOwnerAddress = (
  owner: PositionOwner,
  context = 'PositionOwner',
): string => {
  const raw = typeof owner === 'string' ? owner : owner.address;
  assertValidRecipientAddress(raw, context);
  if (isRelayAdaptAddress(raw)) {
    throw new Error(
      `${context}: position owner must be an account that can act for itself, not the shared relay-adapt contract ("${raw}") — a position booked against it is in shared custody and nothing can unwind it`,
    );
  }
  return getAddress(raw);
};

/**
 * Validate a position owner for a **read** — a risk/health/rediscovery scan.
 *
 * Deliberately NOT {@link resolvePositionOwnerAddress}: the relay-adapt
 * rejection is correct when routing a position and wrong when inspecting one. A
 * scanner must be able to read *any* account's position, including one already
 * stranded on the relay-adapt — refusing to look is how a stranded position
 * stays invisible.
 */
export const resolvePositionOwnerAddressForRead = (
  owner: PositionOwner,
  context = 'PositionOwner',
): string => {
  const raw = typeof owner === 'string' ? owner : owner.address;
  assertValidRecipientAddress(raw, context);
  return getAddress(raw);
};
