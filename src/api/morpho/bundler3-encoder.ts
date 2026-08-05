import { AbiCoder, Interface, ZeroHash, concat, dataSlice, keccak256 } from 'ethers';

/**
 * ABI + hashing primitives for Morpho's **Bundler3** call aggregator, pinned
 * against the deployed bytecode at
 * `0x6566194141eefa99af43bb5aa71460ca2dc90245` (mainnet). Every claim encoded
 * here was read out of that bytecode and then exercised with `eth_call`; the
 * measurements are recorded inline so a future reader can tell what is fact
 * from what is inference.
 *
 * The deployed dispatch table has exactly four branches and all four resolve:
 *
 * | selector     | signature                                          |
 * | ------------ | -------------------------------------------------- |
 * | `0x374f435d` | `multicall((address,bytes,uint256,bool,bytes32)[])` |
 * | `0x803a7fba` | `reenter((address,bytes,uint256,bool,bytes32)[])`   |
 * | `0x5c39fcc1` | `initiator()`                                       |
 * | `0xe69fe134` | `reenterHash()`                                     |
 *
 * `multicall` carries no `CALLVALUE` guard (it is payable); the other three do.
 * `initiator` and `reenterHash` live in **transient** storage (`TLOAD`/`TSTORE`
 * on slots 0 and 1), so both read zero from any `eth_call` made outside an
 * in-flight bundle — a zero from `initiator()` says nothing about whether the
 * contract is wired up.
 *
 * ## Why the callback hash matters
 *
 * `multicall` sets `initiator = msg.sender`, then walks the array. Before each
 * entry it writes
 * `reenterHash = callbackHash == 0 ? 0 : keccak256(bytes20(to) ++ callbackHash)`,
 * performs `to.call{value}(data)`, and then requires `reenterHash == 0` again or
 * reverts `MissingExpectedReenter()`. The only thing that clears it is the
 * target calling back into `reenter(Call[])`, which checks
 * `keccak256(bytes20(msg.sender) ++ keccak256(msg.data[4:]))` against the stored
 * value.
 *
 * The **address comes first** in both concatenations. That is not obvious from
 * the source's `bytes.concat` argument order and was measured: a probe contract
 * installed via an `eth_call` state override read the transient `reenterHash()`
 * from inside a live `multicall` and returned
 * `keccak256(bytes20(to) ++ callbackHash)`, identically on two independent RPCs.
 *
 * Collapsing those two: **`callbackHash` is `keccak256` of the exact bytes the
 * adapter will hand back to `reenter`** — which are the same bytes the caller
 * embedded in the adapter call's trailing `bytes` argument. That is why
 * {@link bundler3CallbackHash} takes raw bytes rather than a decoded array: the
 * hash must be taken over what is actually on the wire, not over a re-encoding
 * of it.
 *
 * Measured end-to-end (mainnet `eth_call`, 1 WETH Morpho Blue flash loan routed
 * Bundler3 -> GeneralAdapter1 -> Blue -> `onMorphoFlashLoan` -> `reenter`):
 * the hash above succeeds; a single flipped bit, a zero hash, or a hash over a
 * blob that is not `abi.encode(Call[])` each fail, and fail *distinctly*. The
 * negative cases are what make the positive one mean something.
 */

const CALL_TUPLE =
  'tuple(address to,bytes data,uint256 value,bool skipRevert,bytes32 callbackHash)';
const CALL_TUPLE_ARRAY = `${CALL_TUPLE}[]`;

/**
 * Morpho's Bundler3 (mainnet). Duplicated deliberately rather than imported
 * from `./morpho-compiler` — this module is the ABI/bytecode-pinned layer and
 * must not depend on the compiler's policy layer. The two are asserted equal by
 * this module's tests.
 */
export const BUNDLER3_CONTRACT_ADDRESS =
  '0x6566194141eefa99af43bb5aa71460ca2dc90245';

/**
 * One entry of a Bundler3 bundle, matching the on-chain struct field-for-field.
 *
 * - `skipRevert` — when true, a failing call is *swallowed* and the bundle
 *   carries on. Measured: an inner call that reverts propagates out of
 *   `multicall` with `skipRevert: false` and does not with `skipRevert: true`.
 * - `callbackHash` — zero unless the target will re-enter; see the module note.
 */
export type Bundler3Call = {
  to: string;
  data: string;
  value: bigint;
  skipRevert: boolean;
  callbackHash: string;
};

const abiCoder = AbiCoder.defaultAbiCoder();

/**
 * Only the two entrypoints are declared. Parameter names are omitted on
 * purpose: what was verified against the chain is the *type sequence* (it is
 * what the selector commits to), not any naming.
 */
export const BUNDLER3_INTERFACE = new Interface([
  `function multicall(${CALL_TUPLE_ARRAY}) payable`,
  `function reenter(${CALL_TUPLE_ARRAY})`,
  'function initiator() view returns (address)',
  'function reenterHash() view returns (bytes32)',
]);

/** `callbackHash` for a call whose target does not re-enter. */
export const NO_CALLBACK_HASH = ZeroHash;

/**
 * The bytes a caller embeds in an adapter call's trailing `bytes` argument to
 * describe the callback bundle. This is `abi.encode(Call[])`, which is
 * byte-identical to `reenter`'s `msg.data[4:]` — the adapter decodes this blob
 * and immediately re-encodes it by calling `reenter`, so a non-canonical
 * encoding here would hash to something the contract never reproduces.
 */
export const encodeBundler3CallbackBundle = (
  calls: readonly Bundler3Call[],
): string => abiCoder.encode([CALL_TUPLE_ARRAY], [calls]);

/**
 * Inverse of {@link encodeBundler3CallbackBundle}. Throws on a blob that is not
 * a well-formed `Call[]` — which is the right outcome, because the adapter runs
 * the same `abi.decode` and reverts on the same input (measured: a
 * `morphoFlashLoan` carrying `0xdeadbeef` as its callback blob reverts).
 */
export const decodeBundler3CallbackBundle = (
  callbackBytes: string,
): Bundler3Call[] => {
  const [decoded] = abiCoder.decode([CALL_TUPLE_ARRAY], callbackBytes);
  return (decoded as unknown[]).map(entry => {
    const call = entry as [string, string, bigint, boolean, string];
    return {
      to: call[0],
      data: call[1],
      value: call[2],
      skipRevert: call[3],
      callbackHash: call[4],
    };
  });
};

/**
 * `keccak256` of the callback blob **exactly as embedded in the adapter call**.
 *
 * Take this over the raw bytes pulled back out of the adapter's calldata, never
 * over a fresh re-encoding of a decoded array: if the two ever disagree the
 * contract follows the wire, and the disagreement surfaces on chain as
 * `IncorrectReenterHash()`.
 */
export const bundler3CallbackHash = (callbackBytes: string): string =>
  keccak256(callbackBytes);

/**
 * The value Bundler3 writes to its transient `reenterHash` slot before invoking
 * a call that declares a callback. Reproduced here so tests can assert the
 * binding directly rather than only observing its effects: the hash commits to
 * the *target*, so only the address in `to` can satisfy it.
 *
 * Operand order is `bytes20(to)` FIRST, then `callbackHash` — measured against
 * the deployed contract's transient slot, not inferred. Getting it backwards
 * still produces a 32-byte value that differs per target, so a test that only
 * checks "two targets hash differently" cannot catch the mistake; assert
 * against the measured constant instead.
 */
export const bundler3ReenterHash = (
  callbackHash: string,
  to: string,
): string => keccak256(concat([dataSlice(to, 0, 20), callbackHash]));

export const encodeBundler3Multicall = (
  calls: readonly Bundler3Call[],
): string => BUNDLER3_INTERFACE.encodeFunctionData('multicall', [calls]);

export const encodeBundler3Reenter = (
  calls: readonly Bundler3Call[],
): string => BUNDLER3_INTERFACE.encodeFunctionData('reenter', [calls]);

/**
 * Bundler3's four custom errors, by selector. All four were read out of the
 * deployed bytecode's revert sites and each was then triggered on mainnet.
 */
export const BUNDLER3_ERROR_SELECTORS: Readonly<Record<string, string>> = {
  '0x36d80ace': 'AlreadyInitiated()',
  '0x1a60d856': 'IncorrectReenterHash()',
  '0xe2eea516': 'MissingExpectedReenter()',
  '0x558c44fc': 'EmptyBundle()',
};

/**
 * Name the Bundler3 error behind a revert payload, or `undefined` when the
 * payload is not one of Bundler3's own errors.
 *
 * This exists because of how the 7702 path fails. Relay-adapt runs the batch
 * with `requireSuccess = false`, so a reverting Bundler3 envelope does not stop
 * the batch — it is recorded as a `CallError` and the trailing shield still
 * runs. The transaction therefore mines with status 1 and the only evidence of
 * what went wrong is that error payload. `undefined` here means "not a Bundler3
 * error", NOT "no error": the revert may have come from an adapter, from Morpho
 * Blue, or from a token, and those must stay distinguishable.
 */
export const describeBundler3Revert = (
  revertData: string,
): string | undefined => {
  if (revertData.length < 10) {
    return undefined;
  }
  return BUNDLER3_ERROR_SELECTORS[revertData.slice(0, 10).toLowerCase()];
};
