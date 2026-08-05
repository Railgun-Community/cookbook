import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoTransactStep } from '../../steps/morpho/morpho-transact-step';
import { RecipeConfig, StepInput } from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_TRANSACT } from '../../models/min-gas-limits';
import {
  MorphoBundle,
  MorphoCompilerAPI,
  buildBundler3MorphoBundle,
} from '../../api/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/** Context passed to a bundle builder so it can query live state. */
export type MorphoBundleBuilderContext = {
  networkName: NetworkName;
  provider: Provider;
  executor: string;
};

export type MorphoBundleBuilder = (
  context: MorphoBundleBuilderContext,
) => Promise<MorphoBundle>;

export type MorphoTransactRecipeOptions = {
  /**
   * Compile the bundle into a SINGLE `Bundler3.multicall` entry instead of one
   * relay-adapt entry per call.
   *
   * **What it buys.** Relay-adapt runs with `requireSuccess = false`, so the
   * default path gives a Morpho bundle N independent entries: a failure
   * part-way through does not stop the rest, and the batch mines having
   * half-applied a composition whose own accounting assumed it reverts as a
   * unit. Bundler3's `_multicall` bubbles an inner revert, so one entry is
   * all-or-nothing — relay-adapt records a single `CallError`, nothing was
   * half-applied, and the trailing shield sweeps untouched funds home.
   *
   * **Off by default**, because turning it on changes what reaches the chain
   * for an existing caller, and because it is not free: the envelope costs a
   * hop and requires the adapter allowances the bundle already declares.
   *
   * **Inert on a single-call bundle.** One call is already atomic as its own
   * relay-adapt entry, so wrapping it pays the hop for nothing. Enabling this
   * on a one-call bundle is a no-op rather than an error — the flag states an
   * intent about compositions, and a caller should not have to branch on
   * length.
   */
  atomicEnvelope?: boolean;
  /**
   * Allow the envelope over calls whose selector the builder cannot decode, so
   * their `callbackHash` is guessed as zero.
   *
   * Needed for most real Morpho bundles, because the set of selectors known not
   * to re-enter holds exactly one. A wrong `callbackHash` reverts
   * `IncorrectReenterHash()` INSIDE the envelope — and since the envelope is
   * all-or-nothing, that takes the whole composition. So this is the caller
   * stating they have established that none of the listed calls re-enters
   * Bundler3. Ignored unless {@link atomicEnvelope} is set.
   */
  allowUndecodedCalls?: boolean;
};

/**
 * Generic Morpho transaction compiler recipe (Mode-2): runs any Morpho-SDK-built
 * bundle through Cookbook, so complex Morpho routing lives in Morpho's
 * maintained SDK rather than being re-implemented here.
 *
 * Self-contained: the recipe invokes the caller's `bundleBuilder` internally
 * (passing the provider + resolved executor) to produce the bundle, shape-checks
 * it and binds its initiator to the executor ({@link
 * MorphoCompilerAPI.assertBundleSafe}), adds exact-amount approvals for each
 * pulled token, then compiles the raw calls via {@link MorphoTransactStep}.
 *
 * TRUST: `assertBundleSafe` validates declared metadata only; it does not decode
 * `calls[].data`, which the ephemeral EOA executes verbatim. The `bundleBuilder`
 * is therefore fully trusted — build the bundle from the official Morpho SDK.
 * The ephemeral EOA (EIP-7702) must be the direct Bundler3 caller so it is the
 * adapter `initiator`; that is enforced by the wallet layer (msg.sender).
 *
 * **A multi-call bundle is NOT atomic on the default path.** Each call becomes
 * its own relay-adapt entry and `requireSuccess = false` continues past a
 * failing one, so a composition can half-apply — see
 * {@link MorphoTransactRecipeOptions.atomicEnvelope} for the opt-in that
 * restores all-or-nothing, and `steps/failure-modes.ts` for what half-applied
 * costs.
 */
export class MorphoTransactRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Transact',
    description: 'Compiles and runs a Morpho SDK bundle.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_TRANSACT,
  };

  private readonly executor: string;
  private readonly bundleBuilder: MorphoBundleBuilder;
  private readonly provider: Provider;
  private readonly options: MorphoTransactRecipeOptions;

  constructor(
    executor: EphemeralExecutor | string,
    bundleBuilder: MorphoBundleBuilder,
    provider: Provider,
    options: MorphoTransactRecipeOptions = {},
  ) {
    super();
    this.executor = resolveExecutorAddress(
      executor,
      'MorphoTransactRecipe executor',
    );
    this.bundleBuilder = bundleBuilder;
    this.provider = provider;
    this.options = options;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoCompilerAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const bundle = await this.bundleBuilder({
      networkName: firstInternalStepInput.networkName,
      provider: this.provider,
      executor: this.executor,
    });

    // Shape-check + bind the bundle initiator to this recipe's executor. NOTE:
    // this validates declared metadata only — calls[] are trusted and executed
    // verbatim, so the bundleBuilder must be trusted (see MorphoCompilerAPI).
    MorphoCompilerAPI.assertBundleSafe(bundle, this.executor);

    // Wrap AFTER `assertBundleSafe`, so the envelope is built from a bundle
    // whose initiator binding and pull/output shapes have already been checked,
    // and the builder's own checks stack on top rather than replacing them.
    //
    // Skipped for a single call: it is already atomic as its own relay-adapt
    // entry, and the envelope would cost a hop for nothing. Pulls and outputs
    // pass through untouched, so the approvals below are unaffected either way —
    // the adapters still pull from the executor, and approving Bundler3 itself
    // stays banned.
    const compiled =
      this.options.atomicEnvelope === true && bundle.calls.length > 1
        ? buildBundler3MorphoBundle({
            initiator: this.executor,
            calls: bundle.calls.map(call => ({
              to: call.to,
              data: call.data,
              value: call.value ?? 0n,
            })),
            pulls: bundle.pulls,
            outputs: bundle.outputs,
            allowUndecodedCalls: this.options.allowUndecodedCalls,
          })
        : bundle;

    const approvals = compiled.pulls.map(
      pull =>
        new ApproveERC20SpenderStep(
          pull.spender,
          { tokenAddress: pull.tokenAddress, decimals: pull.decimals },
          pull.amount,
        ),
    );

    return [...approvals, new MorphoTransactStep(compiled)];
  }
}
