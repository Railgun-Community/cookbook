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

  constructor(
    executor: EphemeralExecutor | string,
    bundleBuilder: MorphoBundleBuilder,
    provider: Provider,
  ) {
    super();
    this.executor = resolveExecutorAddress(
      executor,
      'MorphoTransactRecipe executor',
    );
    this.bundleBuilder = bundleBuilder;
    this.provider = provider;
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

    const approvals = bundle.pulls.map(
      pull =>
        new ApproveERC20SpenderStep(
          pull.spender,
          { tokenAddress: pull.tokenAddress, decimals: pull.decimals },
          pull.amount,
        ),
    );

    return [...approvals, new MorphoTransactStep(bundle)];
  }
}
