import {
  RecipeERC20Info,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { compareERC20Info } from '../../utils/token';

export class DesignateShieldERC20RecipientStep extends Step {
  readonly config: StepConfig = {
    name: 'Designate Shield ERC20s Recipient',
    description: 'Designates ERC20s to shield into a private RAILGUN balance.',
  };

  private readonly toAddress: string;

  private readonly erc20Infos: RecipeERC20Info[];

  constructor(toAddress: string, erc20Infos: RecipeERC20Info[]) {
    super();
    this.toAddress = toAddress;
    this.erc20Infos = erc20Infos;
  }

  async getStepOutput(input: StepInput): Promise<UnvalidatedStepOutput> {
    const { erc20AmountsForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amounts(
        input.erc20Amounts,
        [
          // Filter by comparing inputs with erc20Infos list.
          erc20Amount =>
            this.erc20Infos.find(erc20Info =>
              compareERC20Info(erc20Amount, erc20Info),
            ) != null,
        ],
        {},
      );

    // Designate recipient as toAddress.
    // Fees will be calculated in the ShieldDefaultStep.
    const outputERC20Amounts = erc20AmountsForStep.map(erc20Amount => ({
      ...erc20Amount,
      recipient: this.toAddress,
    }));

    return {
      crossContractCalls: [],
      outputERC20Amounts: [...outputERC20Amounts, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
