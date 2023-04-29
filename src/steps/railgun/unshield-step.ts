import {
  RecipeERC20AmountRecipient,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models';
import { Step } from '../step';
import { RailgunConfig } from '../../models/railgun-config';

export class UnshieldStep extends Step {
  readonly name = 'Unshield';
  readonly description =
    'Unshield ERC20s and NFTs from private RAILGUN balance.';

  readonly canAddStep = false;

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { outputERC20Amounts, feeERC20AmountRecipients } =
      this.getOutputERC20AmountsAndFees(input.erc20Amounts);

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
      throw new Error('No unshield fee set - run init script');
    }
    const unshieldFeeBasisPoints = Number(
      RailgunConfig.UNSHIELD_FEE_BASIS_POINTS,
    );

    const outputERC20Amounts: StepOutputERC20Amount[] = [];
    const feeERC20AmountRecipients: RecipeERC20AmountRecipient[] = [];

    inputERC20Amounts.forEach(erc20Amount => {
      const unshieldedAmount = erc20Amount.expectedBalance
        .mul(10000 - unshieldFeeBasisPoints)
        .div(10000);
      outputERC20Amounts.push({
        ...erc20Amount,
        expectedBalance: unshieldedAmount,
        minBalance: unshieldedAmount,
      });

      const feeAmount = erc20Amount.expectedBalance.sub(unshieldedAmount);
      feeERC20AmountRecipients.push({
        ...erc20Amount,
        amount: feeAmount,
        recipient: 'RAILGUN Unshield Fee',
      });
    });
    return { outputERC20Amounts, feeERC20AmountRecipients };
  }
}
