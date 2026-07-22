import { UnwrapBaseTokenStep } from '../../steps/adapt/unwrap-base-token-step';
import { Recipe } from '../recipe';
import { TransferBaseTokenStep } from '../../steps/adapt/transfer-base-token-step';

import { Step } from '../../steps';
import { RecipeConfig } from '../../models/export-models';
import { MIN_GAS_LIMIT_TRANSFER } from '../../models/min-gas-limits';

/**
 * EIP-7702: pass the executing ephemeral EOA as `recipient`. The unwrap and
 * transfer legs are relay-adapt self-calls that target that account (which
 * holds the tokens); `toAddress` is the external transfer destination. The
 * shared relay-adapt contract is no longer used.
 */
export class UnwrapTransferBaseTokenRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Unwrap Base Token and Transfer',
    description:
      'Unwraps wrapped token into base token, and transfers base token to an external public address.',
    minGasLimit: MIN_GAS_LIMIT_TRANSFER,
  };

  private readonly toAddress: string;
  private readonly recipient: string;
  private readonly amount: Optional<bigint>;

  constructor(toAddress: string, recipient: string, amount?: bigint) {
    super();
    this.toAddress = toAddress;
    this.recipient = recipient;
    this.amount = amount;
  }

  protected supportsNetwork(): boolean {
    return true;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return [
      new UnwrapBaseTokenStep(this.recipient, this.amount),
      new TransferBaseTokenStep(this.toAddress, this.recipient),
    ];
  }
}
