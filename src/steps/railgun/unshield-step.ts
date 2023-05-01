import {
  RecipeERC20AmountRecipient,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { RailgunConfig } from '../../models/railgun-config';

export class UnshieldStep extends Step {
  readonly config = {
    name: 'Unshield',
    description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
  };

  readonly canAddStep = false;

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { outputERC20Amounts, feeERC20AmountRecipients } =
      this.getOutputERC20AmountsAndFees(input.erc20Amounts);
    if (!outputERC20Amounts.every(erc20Amount => !erc20Amount.isBaseToken)) {
      throw new Error('Cannot unshield base token.');
    }

    return {
      populatedTransactions: [],
      spentERC20Amounts: [],
      outputERC20Amounts,
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients,
    };
  }

  private getOutputERC20AmountsAndFees(
    inputERC20Amounts: StepOutputERC20Amount[],
  ) {
    if (RailgunConfig.UNSHIELD_FEE_BASIS_POINTS == null) {
      throw new Error('No unshield fee set - run initCookbook.');
    }
    const unshieldFeeBasisPoints = Number(
      RailgunConfig.UNSHIELD_FEE_BASIS_POINTS,
    );

    const outputERC20Amounts: StepOutputERC20Amount[] = [];
    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = [];

    inputERC20Amounts.forEach(erc20Amount => {
      const unshieldFeeAmount = erc20Amount.expectedBalance
        .mul(unshieldFeeBasisPoints)
        .div(10000);
      const unshieldedAmount =
        erc20Amount.expectedBalance.sub(unshieldFeeAmount);

      outputERC20Amounts.push({
        tokenAddress: erc20Amount.tokenAddress,
        isBaseToken: erc20Amount.isBaseToken,
        expectedBalance: unshieldedAmount,
        minBalance: unshieldedAmount,
        approvedSpender: undefined,
      });

      feeERC20AmountRecipients.push({
        tokenAddress: erc20Amount.tokenAddress,
        amount: unshieldFeeAmount,
        recipient: 'RAILGUN Unshield Fee',
      });
    });
    return { outputERC20Amounts, feeERC20AmountRecipients };
  }
}
