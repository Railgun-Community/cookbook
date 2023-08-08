import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { compareERC20Info } from '../../utils/token';
import { ShieldDefaultStep } from './shield-default-step';
import { ContractTransaction } from 'ethers';
import { RelayAdaptContract } from '../../contract/adapt/relay-adapt-contract';

export class ShieldERC20sStep extends Step {
  readonly config: StepConfig = {
    name: 'Shield ERC20s',
    description: 'Shield ERC20s into private RAILGUN balance.',
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

    const contract = new RelayAdaptContract(input.networkName);
    const crossContractCalls: ContractTransaction[] = [
      await contract.createShield(
        this.toAddress,
        this.erc20Infos.map(erc20Info => erc20Info.tokenAddress),
      ),
    ];

    const {
      outputERC20Amounts: shieldOutputERC20Amounts,
      feeERC20AmountRecipients,
    } = ShieldDefaultStep.getOutputERC20AmountsAndFees(
      input.networkName,
      erc20AmountsForStep,
    );

    const spentERC20Amounts: RecipeERC20AmountRecipient[] =
      shieldOutputERC20Amounts.map(erc20Amount => {
        return {
          tokenAddress: erc20Amount.tokenAddress,
          decimals: erc20Amount.decimals,
          amount: erc20Amount.expectedBalance,
          recipient: this.toAddress,
        };
      });

    return {
      crossContractCalls,
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
      feeERC20AmountRecipients,
      spentERC20Amounts,
    };
  }
}
