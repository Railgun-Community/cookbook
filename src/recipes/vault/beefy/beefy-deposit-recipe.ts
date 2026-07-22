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
import { MIN_GAS_LIMIT_BEEFY_VAULT_DEPOSIT } from '../../../models/min-gas-limits';

/**
 * EIP-7702: the batch executes as the ephemeral EOA, so the minted vault shares
 * are received by that account (msg.sender). No relay-adapt recipient is baked in.
 */
export class BeefyDepositRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Beefy Vault Deposit',
    description:
      'Auto-approves and deposits tokens into a yield-bearing Beefy Vault.',
    minGasLimit: MIN_GAS_LIMIT_BEEFY_VAULT_DEPOSIT,
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
