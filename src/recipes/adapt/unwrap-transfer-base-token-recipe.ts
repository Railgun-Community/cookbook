import { UnwrapBaseTokenStep } from '../../steps/adapt/unwrap-base-token-step';
import { Recipe } from '../recipe';
import { TransferBaseTokenStep } from '../../steps/adapt/transfer-base-token-step';

import { Step } from '../../steps';
import { RecipeConfig } from '../../models/export-models';

export class UnwrapTransferBaseTokenRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Unwrap Base Token and Transfer',
    description:
      'Unwraps wrapped token into base token, and transfers base token to an external public address.',
  };

  private readonly toAddress: string;
  private readonly amount: Optional<bigint>;

  constructor(toAddress: string, amount?: bigint) {
    super();
    this.toAddress = toAddress;
    this.amount = amount;
  }

  protected supportsNetwork(): boolean {
    return true;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return [
      new UnwrapBaseTokenStep(this.amount),
      new TransferBaseTokenStep(this.toAddress),
    ];
  }
}
