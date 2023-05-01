import {
  RecipeERC20AmountRecipient,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { RailgunConfig } from '../../models/railgun-config';

export class ShieldStep extends Step {
  readonly config = {
    name: 'Shield',
    description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
  };

  readonly canAddStep = false;

  async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
    const { outputERC20Amounts, feeERC20AmountRecipients } =
      this.getOutputERC20AmountsAndFees(input.erc20Amounts);
    if (!outputERC20Amounts.every(erc20Amount => !erc20Amount.isBaseToken)) {
      throw new Error('Cannot shield base token.');
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
    if (RailgunConfig.SHIELD_FEE_BASIS_POINTS == null) {
      throw new Error('No shield fee set - run initCookbook.');
    }
    const shieldFeeBasisPoints = Number(RailgunConfig.SHIELD_FEE_BASIS_POINTS);

    const outputERC20Amounts: StepOutputERC20Amount[] = [];
    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = [];

    inputERC20Amounts.forEach(erc20Amount => {
      const shieldedAmount = erc20Amount.expectedBalance
        .mul(10000 - shieldFeeBasisPoints)
        .div(10000);
      outputERC20Amounts.push({
        ...erc20Amount,
        expectedBalance: shieldedAmount,
        minBalance: shieldedAmount,
      });

      const feeAmount = erc20Amount.expectedBalance.sub(shieldedAmount);
      feeERC20AmountRecipients.push({
        tokenAddress: erc20Amount.tokenAddress,
        amount: feeAmount,
        recipient: 'RAILGUN Shield Fee',
      });
    });
    return { outputERC20Amounts, feeERC20AmountRecipients };
  }
}
