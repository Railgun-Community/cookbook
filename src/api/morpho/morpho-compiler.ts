import { NetworkName, isDefined } from '@railgun-community/shared-models';
import { EphemeralExecutor, resolveExecutorAddress } from '../../utils/7702';
import { validateContractAddress } from '../../utils/address';

/**
 * Morpho's Bundler3 (mainnet). Approvals must NEVER target Bundler3 — anybody
 * can drive arbitrary calls through it. Approvals go to GeneralAdapter1 (or the
 * concrete vault/Blue), and the ephemeral EOA must be the direct caller of
 * Bundler3 so it is the adapter `initiator`.
 */
export const BUNDLER3_ADDRESS =
  '0x6566194141eefa99af43bb5aa71460ca2dc90245';
export const GENERAL_ADAPTER1_ADDRESS =
  '0x4a6c312ec70e8747a587ee860a0353cd42be0ae0';

/** A raw call as produced by the Morpho SDK ({ to, data, value }). */
export type MorphoRawCall = {
  to: string;
  data: string;
  value?: bigint;
};

/** A token the bundle pulls from the initiator — becomes an approval + a spend. */
export type MorphoTokenPull = {
  tokenAddress: string;
  decimals: bigint;
  amount: bigint;
  spender: string;
};

/** A token the bundle delivers to the initiator — becomes a shielded output. */
export type MorphoTokenOutput = {
  tokenAddress: string;
  decimals: bigint;
  expectedAmount: bigint;
  minAmount: bigint;
};

/**
 * A normalized, SDK-agnostic Morpho bundle. The caller builds this from the
 * official Morpho SDK (or by hand); the compiler turns it into Cookbook steps +
 * accounting without Cookbook re-implementing Morpho routing.
 */
export type MorphoBundle = {
  /** The executing ephemeral EOA (EIP-7702) — Bundler3 initiator / fund owner. */
  initiator: string;
  calls: MorphoRawCall[];
  pulls: MorphoTokenPull[];
  outputs: MorphoTokenOutput[];
};

/**
 * Shape validation for a {@link MorphoBundle} before it is compiled into steps.
 *
 * IMPORTANT — this is NOT a security boundary. It checks only the bundle's
 * DECLARED metadata (initiator, pull/output shapes, no *declared* approval to
 * Bundler3). It does NOT decode `calls[].data`, so it cannot stop a
 * caller-supplied bundle from hiding an `approve(Bundler3, …)` in a raw call,
 * approving an arbitrary spender, or moving funds in ways its declared
 * pulls/outputs don't reflect. The ephemeral EOA executes `calls[]` verbatim, so
 * the `bundleBuilder` is fully trusted — use only with a bundle you built from
 * the official Morpho SDK.
 */
export class MorphoCompilerAPI {
  static supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  /**
   * @param bundle - the normalized bundle to shape-check.
   * @param expectedInitiator - when provided, assert the bundle initiator
   *   resolves to this executor (the ephemeral EOA / Bundler3 `initiator`).
   *   Standalone callers SHOULD pass it; the recipe always does.
   */
  static assertBundleSafe(
    bundle: MorphoBundle,
    expectedInitiator?: EphemeralExecutor | string,
  ): void {
    const initiator = resolveExecutorAddress(
      bundle.initiator,
      'MorphoBundle initiator',
    );
    if (isDefined(expectedInitiator)) {
      const expected = resolveExecutorAddress(
        expectedInitiator,
        'MorphoBundle expected initiator',
      );
      if (initiator !== expected) {
        throw new Error(
          'morpho-compiler: bundle initiator does not match the expected executor',
        );
      }
    }

    if (!bundle.calls.length) {
      throw new Error('morpho-compiler: bundle has no calls');
    }
    bundle.calls.forEach((call, i) => {
      if (!validateContractAddress(call.to)) {
        throw new Error(`morpho-compiler: call ${i} has invalid 'to'`);
      }
      // Native value is not modelled by pulls/outputs, so a value>0 call would
      // be an unaccounted spend of the ephemeral EOA's ETH — reject it.
      if ((call.value ?? 0n) !== 0n) {
        throw new Error(
          `morpho-compiler: call ${i} carries native value (${call.value}); native value is unsupported`,
        );
      }
    });

    const seenPullTokens = new Set<string>();
    bundle.pulls.forEach((pull, i) => {
      if (!validateContractAddress(pull.tokenAddress)) {
        throw new Error(`morpho-compiler: pull ${i} has invalid token`);
      }
      if (!validateContractAddress(pull.spender)) {
        throw new Error(`morpho-compiler: pull ${i} has invalid spender`);
      }
      // Never *declare* an approval to Bundler3 — anyone can drive arbitrary
      // calls through it. (Declared-shape guard only; see the class note.)
      if (pull.spender.toLowerCase() === BUNDLER3_ADDRESS.toLowerCase()) {
        throw new Error(
          `morpho-compiler: pull ${i} approves Bundler3 (forbidden); approve GeneralAdapter1 or the target instead`,
        );
      }
      if (pull.amount <= 0n) {
        throw new Error(`morpho-compiler: pull ${i} amount must be > 0`);
      }
      // The transact step de-dupes pulls by token (keeping the last), so two
      // pulls of the same token silently under-account the spend while the
      // recipe still emits one approval per pull — reject the ambiguity.
      const tokenKey = pull.tokenAddress.toLowerCase();
      if (seenPullTokens.has(tokenKey)) {
        throw new Error(
          `morpho-compiler: pull ${i} duplicates token ${pull.tokenAddress}; aggregate same-token pulls into one`,
        );
      }
      seenPullTokens.add(tokenKey);
    });

    bundle.outputs.forEach((out, i) => {
      if (!validateContractAddress(out.tokenAddress)) {
        throw new Error(`morpho-compiler: output ${i} has invalid token`);
      }
      if (out.minAmount > out.expectedAmount) {
        throw new Error(
          `morpho-compiler: output ${i} minAmount > expectedAmount`,
        );
      }
    });
  }
}
