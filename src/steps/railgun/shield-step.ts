import {
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { NetworkName } from '@railgun-community/shared-models';
import { getShieldFee, getShieldedAmountAfterFee } from '../../utils/fee';

export class ShieldStep extends Step {
  readonly config: StepConfig = {
    name: 'Shield',
    description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
  };

  readonly canAddStep = false;

  async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
    const { outputERC20Amounts, feeERC20AmountRecipients } =
      this.getOutputERC20AmountsAndFees(input.networkName, input.erc20Amounts);
    if (
      !outputERC20Amounts.every(
        erc20Amount => !(erc20Amount.isBaseToken ?? false),
      )
    ) {
      throw new Error('Cannot shield base token.');
    }

    return {
      crossContractCalls: [],

      outputERC20Amounts,
      outputNFTs: input.nfts,
      feeERC20AmountRecipients,
    };
  }

  private getOutputERC20AmountsAndFees(
    networkName: NetworkName,
    inputERC20Amounts: StepOutputERC20Amount[],
  ) {
    const outputERC20Amounts: StepOutputERC20Amount[] = [];
    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = [];

    inputERC20Amounts.forEach(erc20Amount => {
      const shieldFeeAmount = getShieldFee(
        networkName,
        erc20Amount.expectedBalance,
      );
      const shieldedAmount = getShieldedAmountAfterFee(
        networkName,
        erc20Amount.expectedBalance,
      );
      const shieldedAmountMinimum = getShieldedAmountAfterFee(
        networkName,
        erc20Amount.minBalance,
      );

      outputERC20Amounts.push({
        tokenAddress: erc20Amount.tokenAddress,
        decimals: erc20Amount.decimals,
        isBaseToken: erc20Amount.isBaseToken,
        approvedSpender: erc20Amount.approvedSpender,
        expectedBalance: shieldedAmount,
        minBalance: shieldedAmountMinimum,
      });

      feeERC20AmountRecipients.push({
        tokenAddress: erc20Amount.tokenAddress,
        decimals: erc20Amount.decimals,
        amount: shieldFeeAmount,
        recipient: 'RAILGUN Shield Fee',
      });
    });
    return { outputERC20Amounts, feeERC20AmountRecipients };
  }
}
