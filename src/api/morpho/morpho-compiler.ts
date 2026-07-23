import { NetworkName } from '@railgun-community/shared-models';
import { resolveExecutorAddress } from '../../utils/7702';
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
 * Validation for a {@link MorphoBundle} before it is compiled into steps. Keeps
 * the self-contained + safe-by-default invariants: the initiator is a valid
 * ephemeral EOA, no approval targets Bundler3, and amounts/addresses are sane.
 */
export class MorphoCompilerAPI {
  static supportsNetwork(networkName: NetworkName): boolean {
    return networkName === NetworkName.Ethereum;
  }

  static assertBundleSafe(bundle: MorphoBundle): void {
    resolveExecutorAddress(bundle.initiator, 'MorphoBundle initiator');

    if (!bundle.calls.length) {
      throw new Error('morpho-compiler: bundle has no calls');
    }
    bundle.calls.forEach((call, i) => {
      if (!validateContractAddress(call.to)) {
        throw new Error(`morpho-compiler: call ${i} has invalid 'to'`);
      }
      if (
        call.to.toLowerCase() === BUNDLER3_ADDRESS.toLowerCase() &&
        (call.value ?? 0n) < 0n
      ) {
        throw new Error(`morpho-compiler: call ${i} has negative value`);
      }
    });

    bundle.pulls.forEach((pull, i) => {
      if (!validateContractAddress(pull.tokenAddress)) {
        throw new Error(`morpho-compiler: pull ${i} has invalid token`);
      }
      if (!validateContractAddress(pull.spender)) {
        throw new Error(`morpho-compiler: pull ${i} has invalid spender`);
      }
      // Never approve Bundler3 — approvals go to GeneralAdapter1 / the target.
      if (pull.spender.toLowerCase() === BUNDLER3_ADDRESS.toLowerCase()) {
        throw new Error(
          `morpho-compiler: pull ${i} approves Bundler3 (forbidden); approve GeneralAdapter1 or the target instead`,
        );
      }
      if (pull.amount <= 0n) {
        throw new Error(`morpho-compiler: pull ${i} amount must be > 0`);
      }
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
