import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils/token';
import { Step } from '../../step';
import { BeefyVaultData } from '../../../api/beefy';
import { BeefyVaultContract } from '../../../contract/vault/beefy/beefy-vault-contract';
import { calculateOutputsForBeefyDeposit } from './beefy-util';

export class BeefyDepositStep extends Step {
  readonly config: StepConfig = {
    name: 'Beefy Vault Deposit',
    description: 'Deposits into a yield-bearing Beefy Vault.',
  };

  private readonly vault: BeefyVaultData;

  constructor(vault: BeefyVaultData) {
    super();
    this.vault = vault;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      vaultName,
      depositERC20Address,
      depositERC20Decimals,
      vaultContractAddress,
      vaultTokenAddress,
      vaultRate,
      depositFeeBasisPoints,
    } = this.vault;
    const { erc20Amounts } = input;

    const depositERC20Info: RecipeERC20Info = {
      tokenAddress: depositERC20Address,
      decimals: depositERC20Decimals,
    };
    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, depositERC20Info) &&
          isApprovedForSpender(erc20Amount, vaultContractAddress),
        undefined, // amount
      );

    const contract = new BeefyVaultContract(vaultContractAddress);
    const crossContractCall = await contract.createDepositAll();

    const {
      depositFeeAmount,
      depositAmountAfterFee,
      receivedVaultTokenAmount,
    } = calculateOutputsForBeefyDeposit(
      erc20AmountForStep.expectedBalance,
      depositFeeBasisPoints,
      depositERC20Decimals,
      vaultRate,
    );

    const spentERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...depositERC20Info,
      amount: depositAmountAfterFee,
      recipient: `${vaultName} Vault`,
    };
    const outputERC20Amount: StepOutputERC20Amount = {
      tokenAddress: vaultTokenAddress,
      decimals: depositERC20Decimals,
      expectedBalance: receivedVaultTokenAmount,
      minBalance: receivedVaultTokenAmount,
      approvedSpender: undefined,
    };
    const feeERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...depositERC20Info,
      amount: depositFeeAmount,
      recipient: `${vaultName} Vault Deposit Fee`,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentERC20AmountRecipient],
      outputERC20Amounts: [outputERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [feeERC20AmountRecipient],
    };
  }
}
