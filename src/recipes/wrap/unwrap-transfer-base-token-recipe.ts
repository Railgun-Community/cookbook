import { UnwrapBaseTokenStep } from '../../steps/relay/unwrap-base-token-step';
import { Recipe } from '../recipe';
import { TransferBaseTokenStep } from '../../steps/relay/transfer-base-token-step';
import { BigNumber } from '@ethersproject/bignumber';

export class UnwrapTransferBaseTokenRecipe extends Recipe {
  readonly name = 'Unwrap Base Token and Transfer';
  readonly description =
    'Unwraps wrapped token into base token, and transfers base token to an external public address.';

  constructor(toAddress: string, amount?: BigNumber) {
    super();

    this.addSteps([
      new UnwrapBaseTokenStep(amount),
      new TransferBaseTokenStep(toAddress),
    ]);
  }
}
