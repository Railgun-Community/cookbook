import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { MorphoBlueSetAuthorizationStep } from '../../steps/morpho/blue-set-authorization-step';
import { RecipeConfig, StepInput } from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_REPAY } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Authorize (or revoke) an operator on the ephemeral EOA's Morpho Blue
 * positions. Standalone or composable; only relevant for the retained-account /
 * Bundler3 model. Moves no tokens.
 */
export class MorphoBlueSetAuthorizationRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Set Authorization',
    description: 'Authorizes or revokes an operator on Morpho Blue positions.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
  };

  private readonly authorized: string;
  private readonly isAuthorized: boolean;

  constructor(
    authorized: EphemeralExecutor | string,
    isAuthorized: boolean,
  ) {
    super();
    this.authorized = resolveExecutorAddress(
      authorized,
      'MorphoBlueSetAuthorizationRecipe authorized',
    );
    this.isAuthorized = isAuthorized;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    return [
      new MorphoBlueSetAuthorizationStep(this.authorized, this.isAuthorized),
    ];
  }
}
