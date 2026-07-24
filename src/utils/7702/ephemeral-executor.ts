import { getAddress } from 'ethers';
import { NETWORK_CONFIG } from '@railgun-community/shared-models';
import { assertValidRecipientAddress } from '../address';

/**
 * All known RAILGUN relay-adapt contract addresses (every configured network),
 * lowercased. The 7702 executor is an ephemeral EOA and must NEVER be one of
 * these: routing a recipe's funds/positions to the shared relay-adapt contract
 * would mix an individual user's assets into shared custody. Network-agnostic on
 * purpose — an executor should not be a relay-adapt on any chain, which also
 * keeps the validator free of per-call network context.
 */
const RELAY_ADAPT_ADDRESSES: ReadonlySet<string> = new Set(
  Object.values(NETWORK_CONFIG)
    .map(network => network.relayAdaptContract)
    .filter(
      (address): address is string =>
        typeof address === 'string' && address.length > 0,
    )
    .map(address => address.toLowerCase()),
);

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
 * checksummed, non-zero EVM address that is not a shared relay-adapt contract.
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
 * Validate a 7702 executor address: it must be a well-formed, non-zero EVM
 * address (via the canonical {@link assertValidRecipientAddress}) AND must not
 * be a shared relay-adapt contract (funds/positions must route to the ephemeral
 * EOA, never shared custody). Throws on violation.
 */
export const assertValidExecutorAddress = (
  address: string,
  context = 'EphemeralExecutor',
): void => {
  assertValidRecipientAddress(address, context);
  if (RELAY_ADAPT_ADDRESSES.has(address.toLowerCase())) {
    throw new Error(
      `${context}: executor must be the ephemeral EOA, not the shared relay-adapt contract ("${address}")`,
    );
  }
};

/**
 * Validate and wrap a raw address as an {@link EphemeralExecutor}. Throws (via
 * {@link assertValidExecutorAddress}) on a malformed, zero, or relay-adapt
 * address, then normalises to a checksummed form.
 */
export const makeEphemeralExecutor = (
  address: string,
  context = 'EphemeralExecutor',
): EphemeralExecutor => {
  assertValidExecutorAddress(address, context);
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
  // Re-validate even a wrapped value: it is checksummed at construction, but
  // this keeps resolve() total even if the object was built by other means.
  const raw = typeof executor === 'string' ? executor : executor.address;
  assertValidExecutorAddress(raw, context);
  return getAddress(raw);
};
