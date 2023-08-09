import { Recipe } from '../recipe';
import { EmptyTransferBaseTokenStep, Step } from '../../steps';
import { RecipeConfig, RecipeERC20Info } from '../../models/export-models';
import { MIN_GAS_LIMIT_EMPTY_SHIELD } from '../../models/min-gas-limits';
import { DesignateShieldERC20RecipientStep } from '../../steps/railgun/designate-shield-erc20-recipient-step';

export class DesignateShieldERC20RecipientEmptyRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Designate Shield ERC20 Recipient Empty Recipe',
    description:
      'Shield empty recipe for testing. Designates erc20 tokens to be shielded to an address.',
    minGasLimit: MIN_GAS_LIMIT_EMPTY_SHIELD,
  };

  toAddress: string;
  erc20Infos: RecipeERC20Info[];

  constructor(toAddress: string, erc20Infos: RecipeERC20Info[]) {
    super();
    this.toAddress = toAddress;
    this.erc20Infos = erc20Infos;
  }

  protected supportsNetwork(): boolean {
    return true;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return [
      new EmptyTransferBaseTokenStep(),
      new DesignateShieldERC20RecipientStep(this.toAddress, this.erc20Infos),
    ];
  }
}
