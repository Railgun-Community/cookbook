import { Recipe } from '../../recipe';
import { Step } from '../../../steps';
import { BeefyAPI } from '../../../api/beefy';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../models/export-models';
import { BeefyWithdrawStep } from '../../../steps/vault/beefy/beefy-withdraw-step';
import { RecipeConfig } from '../../../models/export-models';

export class BeefyWithdrawRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Beefy Vault Withdraw',
    description: 'Withdraws ERC20 tokens from yield-bearing Beefy Vault.',
  };

  protected readonly vaultID: string;

  constructor(vaultID: string) {
    super();
    this.vaultID = vaultID;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return BeefyAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName } = firstInternalStepInput;
    const vault = await BeefyAPI.getBeefyVaultForID(this.vaultID, networkName);
    return [new BeefyWithdrawStep(vault)];
  }
}
