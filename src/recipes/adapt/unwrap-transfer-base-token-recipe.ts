import { UnwrapBaseTokenStep } from '../../steps/adapt/unwrap-base-token-step';
import { Recipe } from '../recipe';
import { TransferBaseTokenStep } from '../../steps/adapt/transfer-base-token-step';
import { BigNumber } from '@ethersproject/bignumber';
import { Step } from '../../steps';

export class UnwrapTransferBaseTokenRecipe extends Recipe {
  readonly name = 'Unwrap Base Token and Transfer';
  readonly description =
    'Unwraps wrapped token into base token, and transfers base token to an external public address.';

  private readonly toAddress: string;
  private readonly amount: Optional<BigNumber>;

  constructor(toAddress: string, amount?: BigNumber) {
    super();
    this.toAddress = toAddress;
    this.amount = amount;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return [
      new UnwrapBaseTokenStep(this.amount),
      new TransferBaseTokenStep(this.toAddress),
    ];
  }
}
