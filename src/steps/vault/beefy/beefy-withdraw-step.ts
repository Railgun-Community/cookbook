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
    const populatedTransaction = await contract.createDepositAll();

    const decimalsAdjustment = BigNumber.from(10).pow(depositERC20Decimals);
    const vaultWithdrawAmount = erc20AmountForStep.expectedBalance;
    const receivedWithdrawAmount = BigNumber.from(vaultWithdrawAmount)
      .mul(vaultRate)
      .div(decimalsAdjustment);

    const withdrawFeeBasisPoints = BigNumber.from(withdrawFee * 10000);
    const withdrawFeeAmount = BigNumber.from(receivedWithdrawAmount)
      .mul(withdrawFeeBasisPoints)
      .div(10000);
    const withdrawAmountAfterFee =
      receivedWithdrawAmount.sub(withdrawFeeAmount);

    const spentERC20AmountRecipient: RecipeERC20AmountRecipient = {
      ...withdrawERC20Info,
      amount: vaultWithdrawAmount,
      recipient: `${vaultName} (${vaultID})`,
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
      recipient: `Beefy Fee`,
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
