import { getAddress } from 'ethers';
import { assertValidRecipientAddress } from '../address';

/**
 * EIP-7702 execution identity.
 *
 * Under the 7702 relay-adapt flow, a recipe's cross-contract batch executes as
 * an *ephemeral EOA* (the account the delegated code runs as) rather than the
 * shared relay-adapt contract. Every recipe that routes funds — a 0x `taker`, a
 * router `to`, an ERC-4626 `receiver`, a Morpho `onBehalf`/`receiver`, or a
 * relay-adapt self-call target — must point at *this* account so the assets
 * land on, and positions are owned by, the executing identity.
 *
 * This is intentionally a nominal wrapper (not a bare string) so a call site
 * that requires a validated executor cannot be handed an arbitrary,
 * un-validated address by mistake. The underlying value is always a
 * checksummed, non-zero EVM address.
 *
 * Non-atomic flows: the same executor identity may be reused across several
 * separate `execute()` batches (e.g. supply collateral now, borrow later). For
 * un-tokenized positions (Morpho Blue) the executor address is the *only*
 * handle to the position — it must be the identical account in each batch.
 */
export type EphemeralExecutor = {
  readonly __brand: 'EphemeralExecutor';
  readonly address: string;
};

/**
 * Validate and wrap a raw address as an {@link EphemeralExecutor}. Throws (via
 * the canonical {@link assertValidRecipientAddress}) on a malformed or
 * zero address, then normalises to a checksummed form.
 */
export const makeEphemeralExecutor = (
  address: string,
  context = 'EphemeralExecutor',
): EphemeralExecutor => {
  assertValidRecipientAddress(address, context);
  return {
    __brand: 'EphemeralExecutor',
    address: getAddress(address),
  };
};

/**
 * Accept either an {@link EphemeralExecutor} or a raw address string and return
 * the validated, checksummed address string ready to bake into call data. This
 * is the single choke point every 7702-aware step should route its
 * recipient/executor argument through.
 */
export const resolveExecutorAddress = (
  executor: EphemeralExecutor | string,
  context = 'EphemeralExecutor',
): string => {
  if (typeof executor === 'string') {
    assertValidRecipientAddress(executor, context);
    return getAddress(executor);
  }
  // Re-validate the wrapped value: it is checksummed at construction, but this
  // keeps resolve() total even if the object was built by other means.
  assertValidRecipientAddress(executor.address, context);
  return getAddress(executor.address);
};

/**
 * Alias of the canonical recipient validator so 7702-aware code can import
 * address validation from a single module without duplicating the check.
 */
export const assertValidExecutorAddress = assertValidRecipientAddress;
