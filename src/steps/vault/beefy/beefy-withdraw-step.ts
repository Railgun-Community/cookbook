import { BigNumber } from '@ethersproject/bignumber';
import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info } from '../../../utils/token';
import { Step } from '../../step';
import { BeefyVaultData } from '../../../api/beefy';
import { BeefyVaultContract } from '../../../contract/vault/beefy-vault-contract';
import { calculateOutputsForBeefyWithdraw } from './beefy-util';

export class BeefyWithdrawStep extends Step {
  readonly config = {
    name: 'Beefy Vault Withdraw',
    description: 'Withdraws from a yield-bearing Beefy Vault.',
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
      vaultID,
      vaultName,
      depositERC20Address,
      depositERC20Decimals,
      vaultContractAddress,
      vaultTokenAddress,
      vaultRate,
      withdrawFee,
    } = this.vault;
    const { erc20Amounts } = input;

    const withdrawERC20Info: RecipeERC20Info = {
      tokenAddress: vaultTokenAddress,
    };
    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount => compareERC20Info(erc20Amount, withdrawERC20Info),
        undefined, // amount
      );

    const contract = new BeefyVaultContract(vaultContractAddress);
    const populatedTransaction = await contract.createWithdrawAll();

    const { withdrawFeeAmount, withdrawAmountAfterFee } =
      calculateOutputsForBeefyWithdraw(
        erc20AmountForStep.expectedBalance,
        withdrawFee,
        depositERC20Decimals,
        vaultRate,
      );

    const spentERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...withdrawERC20Info,
      amount: erc20AmountForStep.expectedBalance,
      recipient: `${vaultName} Vault`,
    };
    const outputERC20Amount: StepOutputERC20Amount = {
      tokenAddress: depositERC20Address,
      expectedBalance: withdrawAmountAfterFee,
      minBalance: withdrawAmountAfterFee,
      approvedSpender: undefined,
    };
    const feeERC20Amount: RecipeERC20AmountRecipient = {
      tokenAddress: depositERC20Address,
      amount: withdrawFeeAmount,
      recipient: `Beefy Vault Withdraw Fee`,
    };

    return {
      populatedTransactions: [populatedTransaction],
      spentERC20Amounts: [spentERC20AmountRecipient],
      outputERC20Amounts: [outputERC20Amount, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [feeERC20Amount],
    };
  }
}
