import { FunctionFragment, Interface } from 'ethers';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { validateContractAddress } from '../../utils/address';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
import {
  BUNDLER3_ADDRESS,
  MorphoBundle,
  MorphoCompilerAPI,
  MorphoTokenOutput,
  MorphoTokenPull,
} from './morpho-compiler';
import {
  Bundler3Call,
  NO_CALLBACK_HASH,
  bundler3CallbackHash,
  decodeBundler3CallbackBundle,
  encodeBundler3Multicall,
} from './bundler3-encoder';

/**
 * Wraps a list of Morpho-SDK calls in a **single** `Bundler3.multicall`, so the
 * whole composition reaches relay-adapt as one entry.
 *
 * ## Is Bundler3 the right tool under 7702?
 *
 * The premise of the 7702 path is that the ephemeral EOA *is* the position
 * handle and executes the batch itself, which removes the usual reason to reach
 * for an aggregator. Two reasons survive that, and they are the only two:
 *
 * **1. It restores atomicity, which this path otherwise does not have.**
 * Relay-adapt runs the batch with `requireSuccess = false`: a failing call does
 * not stop the array, the remaining calls still run, and the transaction mines
 * with status 1 regardless. `MorphoTransactStep` flattens `bundle.calls` into N
 * separate relay-adapt entries, so a Morpho SDK bundle — authored on the
 * assumption that it reverts as a unit — silently loses that guarantee, and a
 * failure part-way through leaves protocol state the bundle's own accounting
 * never modelled. Bundler3's `_multicall` propagates an inner revert (measured:
 * a reverting inner call propagates out of `multicall` with `skipRevert: false`
 * and does not with `skipRevert: true`). Compiling the composition into one
 * entry therefore makes it all-or-nothing again: relay-adapt records a single
 * `CallError`, nothing was half-applied, and the trailing shield sweeps the
 * untouched funds home. This applies to *every* multi-call Morpho composition,
 * not only exotic ones.
 *
 * **2. It is the only way to get a callback.** Morpho Blue's `flashLoan`, and
 * the `data`-carrying forms of `supply` / `supplyCollateral` / `repay`, invoke
 * `onMorpho*` on `msg.sender`. Under 7702 `msg.sender` is the ephemeral EOA
 * running relay-adapt's delegated code, which implements none of those
 * interfaces. So a flash-loan-funded leveraged open or close is not "worse"
 * without Bundler3 — it is *impossible* by direct EOA calls. GeneralAdapter1
 * implements the callbacks and re-enters Bundler3; that machinery has no
 * substitute here.
 *
 * **Where it is NOT warranted:** a single Morpho call. One call is already
 * all-or-nothing as its own relay-adapt entry, so the envelope buys nothing and
 * costs an extra hop plus an allowance to GeneralAdapter1 — a shared contract —
 * instead of to Morpho Blue directly. Prefer the dedicated `recipes/morpho/*`
 * recipes for those. This builder is for compositions.
 *
 * ## What the executor has to be
 *
 * `multicall` sets `initiator = msg.sender`, and GeneralAdapter1 pulls the
 * user's tokens with `transferFrom(initiator, …)`. Measured on mainnet: driving
 * `erc20TransferFrom` through Bundler3 from an address that was given a WETH
 * balance *and* an allowance to GeneralAdapter1 succeeds, and fails if either is
 * missing — so the funds come from the direct caller of `multicall`. The
 * ephemeral EOA must therefore be that direct caller (the wallet layer
 * guarantees this via `msg.sender`), and approvals go to GeneralAdapter1, never
 * to Bundler3, which anyone can drive.
 *
 * ## Trust
 *
 * Unchanged from {@link MorphoCompilerAPI}: `calls[].data` is executed verbatim
 * and this module decodes only the two selectors it needs. The builder is a
 * build-time consistency gate over a bundle you already trust, not a security
 * boundary over one you do not.
 */

/** `type(uint256).max`, used by GeneralAdapter1 as a "whole balance" sentinel. */
const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * The GeneralAdapter1 entrypoints this module decodes. Selectors were matched
 * against the deployed adapter's dispatch table at
 * `0x4a6c312ec70e8747a587ee860a0353cd42be0ae0`; parameter names are given only
 * where the meaning was confirmed by simulation, because a selector commits to
 * the type sequence and nothing else.
 *
 * Every entry here carries its callback bundle as the trailing `bytes`.
 */
const CALLBACK_CARRYING_INTERFACE = new Interface([
  'function morphoSupply((address,address,address,address,uint256),uint256,uint256,uint256,address,bytes)',
  'function morphoSupplyCollateral((address,address,address,address,uint256),uint256,address,bytes)',
  'function morphoRepay((address,address,address,address,uint256),uint256,uint256,uint256,address,bytes)',
  'function morphoFlashLoan(address,uint256,bytes)',
]);

/**
 * Selector -> fragment, built once. Looked up through an explicit map rather
 * than `Interface.getFunction`, so an unrecognized selector is a plain miss
 * instead of depending on that method's behaviour for unknown keys.
 */
const CALLBACK_CARRYING_BY_SELECTOR: ReadonlyMap<string, FunctionFragment> =
  new Map(
    CALLBACK_CARRYING_INTERFACE.fragments
      .filter((fragment): fragment is FunctionFragment => fragment.type === 'function')
      .map(fragment => [fragment.selector.toLowerCase(), fragment]),
  );

/**
 * `morphoFlashLoan` is the odd one out. Morpho Blue gates the `supply` /
 * `supplyCollateral` / `repay` callbacks on `data.length > 0`, so empty bytes
 * there simply means "no callback" — but `flashLoan` calls back
 * unconditionally, and the adapter then `abi.decode`s whatever it was handed.
 * Measured: `morphoFlashLoan` with empty trailing bytes reverts. Empty bytes on
 * that selector is a bundle that cannot succeed, so it is rejected at build
 * time rather than mined as a no-op at full gas cost.
 *
 * The `data.length > 0` gate on the other three is read from Morpho Blue's
 * source, not measured here; it is only ever used to *permit* a zero callback
 * hash, and getting it wrong would surface on chain as a clean
 * `IncorrectReenterHash()` revert of the whole envelope.
 */
const CALLBACK_REQUIRED_SELECTORS: ReadonlySet<string> = new Set([
  CALLBACK_CARRYING_INTERFACE.getFunction('morphoFlashLoan')
    ?.selector as string,
]);

/**
 * `erc20TransferFrom(token, receiver, amount)` — GeneralAdapter1's pull of the
 * initiator's funds. Argument meanings confirmed by simulation, not assumed:
 * with only the initiator's WETH balance and its allowance to the adapter
 * overridden, the call succeeds; remove either and it reverts.
 */
const ERC20_TRANSFER_FROM_INTERFACE = new Interface([
  'function erc20TransferFrom(address token, address receiver, uint256 amount)',
]);

const ERC20_TRANSFER_FROM_SELECTOR = ERC20_TRANSFER_FROM_INTERFACE.getFunction(
  'erc20TransferFrom',
)?.selector as string;

/** Selectors known to take no callback bundle — a positive determination. */
const NO_CALLBACK_SELECTORS: ReadonlySet<string> = new Set([
  ERC20_TRANSFER_FROM_SELECTOR,
]);

/** A call as handed to the builder: the Morpho SDK's `{ to, data, value }`. */
export type Bundler3CallInput = {
  to: string;
  data: string;
  value?: bigint;
  /**
   * Opt a single call out of the envelope's atomicity. Requires
   * `allowNonAtomicCalls` on the bundle, because it reintroduces exactly the
   * partial-application hazard the envelope exists to remove.
   */
  skipRevert?: boolean;
  /**
   * Only for a target whose callback slot this module cannot locate. Leave it
   * undefined for a recognized adapter call — the hash is derived from the
   * embedded bytes, and a hand-written one that disagrees is rejected.
   */
  callbackHash?: string;
};

/** A call whose callback status could not be determined. Never dropped. */
export type Bundler3UndecodedCall = {
  /** Position in the tree: `[2]` is top-level call 2, `[2, 0]` its callback's call 0. */
  path: readonly number[];
  to: string;
  selector: string;
  reason: string;
};

/**
 * Result of walking a bundle. `undecoded` and `complete` follow the same
 * discipline as the Morpho readers: "could not determine" never collapses into
 * "determined to be none".
 *
 * A call left in `undecoded` is assigned a zero callback hash, which is correct
 * for the overwhelming majority of adapter entrypoints. When it is wrong — the
 * target does re-enter — the envelope reverts whole with
 * `MissingExpectedReenter()` or `IncorrectReenterHash()`, so a wrong guess
 * costs a failed batch, never a half-applied one. That is the property that
 * makes a default tolerable at all; it is not a reason to ignore this list.
 */
export type Bundler3CallbackDerivation = {
  calls: Bundler3Call[];
  /** Paths whose callback bundle was located and hashed. */
  derived: readonly (readonly number[])[];
  /** Calls whose callback status could not be positively determined. */
  undecoded: readonly Bundler3UndecodedCall[];
  /** True only when every call in the tree was positively determined. */
  complete: boolean;
};

type CallbackResolution =
  | { kind: 'derived'; callbackHash: string; nested: Bundler3Call[] }
  | { kind: 'none' }
  | { kind: 'unknown'; selector: string };

type WalkContext = {
  allowNonAtomicCalls: boolean;
  derived: (readonly number[])[];
  undecoded: Bundler3UndecodedCall[];
  pullCalls: { path: readonly number[]; token: string; spender: string; amount: bigint }[];
};

const describePath = (path: readonly number[]): string =>
  `call [${path.join('.')}]`;

const selectorOf = (data: string): string => data.slice(0, 10).toLowerCase();

const resolveCallback = (
  data: string,
  path: readonly number[],
): CallbackResolution => {
  const selector = selectorOf(data);

  if (NO_CALLBACK_SELECTORS.has(selector)) {
    return { kind: 'none' };
  }

  const fragment = CALLBACK_CARRYING_BY_SELECTOR.get(selector);
  if (fragment == null) {
    return { kind: 'unknown', selector };
  }

  const args = CALLBACK_CARRYING_INTERFACE.decodeFunctionData(fragment, data);
  const callbackBytes = args[args.length - 1] as string;

  if (callbackBytes === '0x') {
    if (CALLBACK_REQUIRED_SELECTORS.has(selector)) {
      throw new Error(
        `bundler3: ${describePath(path)} calls ${fragment.name} with an empty callback bundle; ` +
          'that callback fires unconditionally and the adapter cannot decode empty bytes, so this bundle always reverts',
      );
    }
    return { kind: 'none' };
  }

  const nested = decodeBundler3CallbackBundle(callbackBytes);
  if (!nested.length) {
    throw new Error(
      `bundler3: ${describePath(path)} carries an empty callback bundle; ` +
        'Bundler3 reverts EmptyBundle() when it re-enters with no calls',
    );
  }

  // Hash the embedded bytes, never a re-encoding of `nested` — the contract
  // hashes what the adapter hands back, which is what is on the wire here.
  return {
    kind: 'derived',
    callbackHash: bundler3CallbackHash(callbackBytes),
    nested,
  };
};

const assertEnvelope = (
  call: { to: string; data: string; value: bigint; skipRevert: boolean },
  path: readonly number[],
  context: WalkContext,
): void => {
  if (!validateContractAddress(call.to)) {
    throw new Error(`bundler3: ${describePath(path)} has invalid 'to'`);
  }
  // `validateContractAddress` is `isAddress`, which accepts the zero address.
  // Bundler3 does NOT check `extcodesize`, so a CALL to a codeless target
  // RETURNS SUCCESS — the envelope reports success having executed nothing, at
  // full gas and both RAILGUN fees. That is exactly the swallowed-failure class
  // this module exists to remove, and the zero address costs nothing to reject
  // here. (The initiator already goes through `assertValidExecutorAddress`,
  // which rejects zero; this closes the same hole on the call targets.)
  if (call.to.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(
      `bundler3: ${describePath(path)} targets the zero address. Bundler3 does ` +
        'not check extcodesize, so this call would SUCCEED having done nothing.',
    );
  }
  if (call.to.toLowerCase() === BUNDLER3_ADDRESS.toLowerCase()) {
    // A nested `multicall` hits the `initiator == address(0)` guard and reverts
    // AlreadyInitiated(); a bare `reenter` is a probe shape, not a bundle shape.
    throw new Error(
      `bundler3: ${describePath(path)} targets Bundler3 itself; Bundler3 reverts AlreadyInitiated() when re-entered through multicall`,
    );
  }
  if (call.data.length < 10) {
    throw new Error(
      `bundler3: ${describePath(path)} carries no selector; a call with neither calldata nor value only burns gas`,
    );
  }
  if (call.value !== 0n) {
    // The envelope reaches Bundler3 with value 0 (MorphoCompilerAPI forbids
    // native value), and Bundler3 holds no balance of ours. Measured: an inner
    // call with value 1 wei reverts. Worse, were Bundler3 to hold a stranded
    // balance, the call would spend somebody else's ETH.
    throw new Error(
      `bundler3: ${describePath(path)} carries native value (${call.value}); the envelope forwards none and Bundler3 holds no balance for us`,
    );
  }
  if (call.skipRevert && !context.allowNonAtomicCalls) {
    throw new Error(
      `bundler3: ${describePath(path)} sets skipRevert, which lets the bundle continue past its own failure — ` +
        'the atomicity this envelope exists to restore. Pass allowNonAtomicCalls to accept that deliberately',
    );
  }
};

const recordPullCall = (
  call: { to: string; data: string },
  path: readonly number[],
  context: WalkContext,
): void => {
  if (selectorOf(call.data) !== ERC20_TRANSFER_FROM_SELECTOR) {
    return;
  }
  const [token, , amount] = ERC20_TRANSFER_FROM_INTERFACE.decodeFunctionData(
    'erc20TransferFrom',
    call.data,
  ) as unknown as [string, string, bigint];
  context.pullCalls.push({ path, token, spender: call.to, amount });
};

/** Validate an already-encoded call (one decoded out of a callback bundle). */
const verifyEncodedCall = (
  call: Bundler3Call,
  path: readonly number[],
  context: WalkContext,
): void => {
  assertEnvelope(call, path, context);
  recordPullCall(call, path, context);

  const resolution = resolveCallback(call.data, path);
  switch (resolution.kind) {
    case 'derived':
      if (
        call.callbackHash.toLowerCase() !==
        resolution.callbackHash.toLowerCase()
      ) {
        throw new Error(
          `bundler3: ${describePath(path)} declares a callbackHash that does not match its embedded callback bundle; ` +
            'Bundler3 reverts IncorrectReenterHash()',
        );
      }
      context.derived.push(path);
      resolution.nested.forEach((nested, i) =>
        verifyEncodedCall(nested, [...path, i], context),
      );
      return;
    case 'none':
      if (call.callbackHash.toLowerCase() !== NO_CALLBACK_HASH) {
        throw new Error(
          `bundler3: ${describePath(path)} declares a callbackHash but carries no callback bundle; ` +
            'Bundler3 reverts MissingExpectedReenter() when nobody re-enters',
        );
      }
      return;
    case 'unknown':
      context.undecoded.push({
        path,
        to: call.to,
        selector: resolution.selector,
        reason:
          'target is not a decoded GeneralAdapter1 entrypoint; whether it re-enters is unknown',
      });
      return;
  }
};

/**
 * Turn caller-supplied `{ to, data, value }` calls into fully-formed Bundler3
 * calls, deriving each `callbackHash` from the callback bundle already embedded
 * in the call's own calldata.
 *
 * Deriving rather than accepting the hash is the whole point: a hand-written
 * `callbackHash` that is off by one bit reverts `IncorrectReenterHash()` on
 * chain, which under `requireSuccess = false` is swallowed into a status-1
 * transaction. Derived from the wire bytes, it cannot disagree.
 *
 * Throws on anything that cannot succeed. Returns the un-determinable cases in
 * `undecoded` rather than pretending they were checked.
 */
const walkBundle = (
  calls: readonly Bundler3CallInput[],
  allowNonAtomicCalls: boolean,
): { resolved: Bundler3Call[]; context: WalkContext } => {
  const context: WalkContext = {
    allowNonAtomicCalls,
    derived: [],
    undecoded: [],
    pullCalls: [],
  };

  const resolved = calls.map((input, index) => {
    const path = [index];
    const call = {
      to: input.to,
      data: input.data,
      value: input.value ?? 0n,
      skipRevert: input.skipRevert ?? false,
    };
    assertEnvelope(call, path, context);
    recordPullCall(call, path, context);

    const resolution = resolveCallback(call.data, path);
    let callbackHash: string;
    switch (resolution.kind) {
      case 'derived':
        callbackHash = resolution.callbackHash;
        if (
          input.callbackHash != null &&
          input.callbackHash.toLowerCase() !== callbackHash.toLowerCase()
        ) {
          throw new Error(
            `bundler3: ${describePath(path)} was given a callbackHash that does not match its embedded callback bundle`,
          );
        }
        context.derived.push(path);
        resolution.nested.forEach((nested, i) =>
          verifyEncodedCall(nested, [...path, i], context),
        );
        break;
      case 'none':
        callbackHash = NO_CALLBACK_HASH;
        if (
          input.callbackHash != null &&
          input.callbackHash.toLowerCase() !== NO_CALLBACK_HASH
        ) {
          throw new Error(
            `bundler3: ${describePath(path)} was given a callbackHash but calls an entrypoint that takes no callback bundle`,
          );
        }
        break;
      case 'unknown':
        callbackHash = input.callbackHash ?? NO_CALLBACK_HASH;
        context.undecoded.push({
          path,
          to: call.to,
          selector: resolution.selector,
          reason:
            input.callbackHash != null
              ? 'caller-declared callbackHash on an undecoded target; not verifiable here'
              : 'target is not a decoded GeneralAdapter1 entrypoint; whether it re-enters is unknown',
        });
        break;
    }

    return { ...call, callbackHash };
  });

  return { resolved, context };
};

export const deriveBundler3Callbacks = (
  calls: readonly Bundler3CallInput[],
  allowNonAtomicCalls = false,
): Bundler3CallbackDerivation => {
  const { resolved, context } = walkBundle(calls, allowNonAtomicCalls);
  return {
    calls: resolved,
    derived: context.derived,
    undecoded: context.undecoded,
    complete: context.undecoded.length === 0,
  };
};

/**
 * Cross-check the bundle's declared `pulls` against the `erc20TransferFrom`
 * calls actually present in its calldata.
 *
 * `MorphoCompilerAPI.assertBundleSafe` cannot do this — it validates declared
 * metadata and never decodes calldata — so the most likely authoring mistake
 * (approving the wrong spender, or too little) survives it and then reverts on
 * chain, silently. Deciding it here is what makes the approval the recipe emits
 * provably the one the adapter needs.
 *
 * **One-directional on purpose.** Every decoded pull must be covered by a
 * declared one; the converse is not required, because a bundle can move the
 * initiator's funds through mechanisms this module does not decode (Permit2,
 * ERC-4626 entrypoints, adapters other than GeneralAdapter1). A clean run here
 * means "no decoded pull is uncovered", not "nothing else moves".
 */
const assertPullsCoverTransferFroms = (
  pullCalls: readonly {
    path: readonly number[];
    token: string;
    spender: string;
    amount: bigint;
  }[],
  pulls: readonly MorphoTokenPull[],
): void => {
  const byToken = new Map(
    pulls.map(pull => [pull.tokenAddress.toLowerCase(), pull]),
  );
  pullCalls.forEach(pullCall => {
    const declared = byToken.get(pullCall.token.toLowerCase());
    if (declared == null) {
      throw new Error(
        `bundler3: ${describePath(pullCall.path)} pulls ${pullCall.token} from the initiator but the bundle declares no pull for it; ` +
          'no approval would be emitted and the transferFrom reverts',
      );
    }
    if (declared.spender.toLowerCase() !== pullCall.spender.toLowerCase()) {
      throw new Error(
        `bundler3: ${describePath(pullCall.path)} pulls ${pullCall.token} via ${pullCall.spender} but the declared pull approves ${declared.spender}`,
      );
    }
    // `type(uint256).max` is a sentinel, not an amount: measured, an
    // erc20TransferFrom of max succeeds against a 1e18 balance while a literal
    // 2e18 reverts. The real ceiling is then the allowance this recipe emits,
    // which is `declared.amount` — so there is nothing to compare it against.
    if (pullCall.amount !== MAX_UINT256 && declared.amount < pullCall.amount) {
      throw new Error(
        `bundler3: ${describePath(pullCall.path)} pulls ${pullCall.amount} of ${pullCall.token} but the declared pull only approves ${declared.amount}`,
      );
    }
  });
};

export type Bundler3MorphoBundleParams = {
  /** The ephemeral EOA (EIP-7702). It must be the direct caller of `multicall`. */
  initiator: EphemeralExecutor | string;
  /** The Morpho SDK's calls, in order. */
  calls: readonly Bundler3CallInput[];
  pulls: readonly MorphoTokenPull[];
  outputs: readonly MorphoTokenOutput[];
  /** Accept `skipRevert` on individual calls. Off by default; see the type. */
  allowNonAtomicCalls?: boolean;
  /**
   * Accept calls whose selector this builder cannot decode, whose `callbackHash`
   * is therefore guessed as zero.
   *
   * Off by default and deliberately noisy: a wrong `callbackHash` reverts
   * `IncorrectReenterHash()` inside the envelope, and the whole point of the
   * envelope is that such a revert is no longer swallowed — so it takes the
   * batch with it. Set this only once you have established that none of the
   * listed calls re-enters Bundler3. Most Morpho calls do not.
   */
  allowUndecodedCalls?: boolean;
};

/**
 * Build a {@link MorphoBundle} whose `calls` is exactly one entry — the
 * `Bundler3.multicall` envelope — so `MorphoTransactStep` compiles the whole
 * composition into a single relay-adapt call and the bundle keeps the
 * all-or-nothing semantics it was authored with.
 *
 * Drop-in for `MorphoTransactRecipe`'s `bundleBuilder`:
 *
 * ```ts
 * const bundleBuilder = async ({ executor }: MorphoBundleBuilderContext) =>
 *   buildBundler3MorphoBundle({ initiator: executor, calls, pulls, outputs });
 * ```
 *
 * Every rejection below is a bundle that cannot succeed on chain. That matters
 * more here than usual: relay-adapt runs with `requireSuccess = false`, so a
 * doomed bundle does not revert the transaction — it mines with status 1 having
 * done nothing, at full gas cost. Validation has to happen at build time or it
 * does not happen at all.
 */
export const buildBundler3MorphoBundle = (
  params: Bundler3MorphoBundleParams,
): MorphoBundle => {
  const initiator = resolveExecutorAddress(
    params.initiator,
    'Bundler3 bundle initiator',
  );

  if (!params.calls.length) {
    throw new Error(
      'bundler3: bundle has no calls; Bundler3 reverts EmptyBundle()',
    );
  }

  const { resolved, context } = walkBundle(
    params.calls,
    params.allowNonAtomicCalls ?? false,
  );

  const bundle: MorphoBundle = {
    initiator,
    calls: [
      {
        to: BUNDLER3_ADDRESS,
        data: encodeBundler3Multicall(resolved),
        value: 0n,
      },
    ],
    pulls: [...params.pulls],
    outputs: [...params.outputs],
  };

  // Inherit the declared-metadata checks rather than restating them: initiator
  // binding, pull/output shapes, and the standing ban on approving Bundler3.
  MorphoCompilerAPI.assertBundleSafe(bundle, initiator);

  assertPullsCoverTransferFroms(context.pullCalls, params.pulls);

  // `undecoded` is the builder's best safety signal and the shipping entrypoint
  // used to drop it on the floor: it computed the list, returned a bare
  // `MorphoBundle` with nowhere to put it, and every call whose selector is not
  // in `NO_CALLBACK_SELECTORS` silently took a guessed zero `callbackHash`.
  // Since that set holds exactly one selector, nearly every real Morpho bundle —
  // `erc4626Deposit`, `morphoBorrow`, `morphoWithdraw`, `erc20Transfer`,
  // Permit2 — lands there. "Could not determine" collapsing into "nothing" at
  // the API boundary is the §9 failure this codebase refuses everywhere else.
  //
  // Throwing by default rather than widening the return type, because a caller
  // who does not know a callback hash was guessed cannot act on it, and the
  // opt-out mirrors `allowNonAtomicCalls` — an explicit statement that the
  // caller has reasoned about it.
  if (context.undecoded.length > 0 && params.allowUndecodedCalls !== true) {
    throw new Error(
      `bundler3: ${context.undecoded.length} call(s) carry a selector this ` +
        'builder cannot decode, so their callbackHash was guessed as zero: ' +
        `${context.undecoded
          .map(call => `${describePath(call.path)} (${call.selector})`)
          .join(', ')}. A wrong ` +
        'callbackHash reverts IncorrectReenterHash() inside the envelope. Pass ' +
        'allowUndecodedCalls: true if you have established that none of these ' +
        'calls re-enters Bundler3.',
    );
  }

  return bundle;
};
