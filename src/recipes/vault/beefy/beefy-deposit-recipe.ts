import { Recipe } from '../../recipe';
import { ApproveERC20SpenderStep, Step } from '../../../steps';
import { BeefyAPI } from '../../../api/beefy';
import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../../models/export-models';
import { BeefyDepositStep } from '../../../steps/vault/beefy/beefy-deposit-step';

export class BeefyDepositRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Beefy Vault Deposit',
    description:
      'Auto-approves and deposits tokens into a yield-bearing Beefy Vault.',
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
    const spender = vault.vaultContractAddress;
    const depositERC20Info: RecipeERC20Info = {
      tokenAddress: vault.depositERC20Address,
      decimals: vault.depositERC20Decimals,
    };
    return [
      new ApproveERC20SpenderStep(spender, depositERC20Info),
      new BeefyDepositStep(vault),
    ];
  }
}
