import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import {
  RecipeConfig,
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
} from '../../models/export-models';
import { SwapRecipe } from './swap-recipe';
import { NetworkName, isDefined } from '@railgun-community/shared-models';
import {
  findFirstInputERC20Amount,
  getIsUnvalidatedRailgunAddress,
} from '../../utils';
import {
  MIN_GAS_LIMIT_0X_SWAP,
  MIN_GAS_LIMIT_0X_SWAP_SHIELD,
  MIN_GAS_LIMIT_0X_SWAP_TRANSFER,
} from '../../models/min-gas-limits';
import {
  TransferBaseTokenStep,
  TransferERC20Step,
  ZeroXV2SwapStep,
} from '../../steps';
import { DesignateShieldERC20RecipientStep } from '../../steps/railgun/designate-shield-erc20-recipient-step';
import {
  ZeroXV2Quote,
  type SwapQuoteDataV2,
  type V2SwapQuoteParams,
} from '../../api/zero-x-v2';

export class ZeroXV2SwapRecipe extends SwapRecipe {
  readonly config: RecipeConfig = {
    name: '0x V2 Exchange Swap',
    description: 'Swaps two ERC20 tokens using 0x V2 Exchange DEX Aggregator.',
    minGasLimit: MIN_GAS_LIMIT_0X_SWAP,
  };

  protected readonly sellERC20Info: RecipeERC20Info;
  protected readonly buyERC20Info: RecipeERC20Info;

  private readonly slippageBasisPoints: number;

  protected readonly destinationAddress: Optional<string>;
  protected readonly isRailgunDestinationAddress: Optional<boolean>;

  constructor(
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    slippageBasisPoints: number,
    destinationAddress?: string,
  ) {
    super();

    this.sellERC20Info = sellERC20Info;
    this.buyERC20Info = buyERC20Info;

    this.slippageBasisPoints = slippageBasisPoints;

    this.destinationAddress = destinationAddress;
    if (isDefined(destinationAddress)) {
      this.isRailgunDestinationAddress =
        getIsUnvalidatedRailgunAddress(destinationAddress);
      if (this.isRailgunDestinationAddress) {
        this.config.name += ' and Shield';
        this.config.minGasLimit = MIN_GAS_LIMIT_0X_SWAP_SHIELD;
      } else {
        this.config.name += ' and Transfer';
        this.config.minGasLimit = MIN_GAS_LIMIT_0X_SWAP_TRANSFER;
      }
    }
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return ZeroXV2Quote.supportsNetwork(networkName);
  }

  async getSwapQuote(
    networkName: NetworkName,
    sellERC20Amount: RecipeERC20Amount,
  ): Promise<SwapQuoteDataV2> {
    const quoteParams: V2SwapQuoteParams = {
      networkName,
      sellERC20Amount,
      buyERC20Info: this.buyERC20Info,
      slippageBasisPoints: this.slippageBasisPoints,
      isRailgun: true,
    };
    return ZeroXV2Quote.getSwapQuote(quoteParams);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName } = firstInternalStepInput;
    const sellERC20Amount = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      this.sellERC20Info,
    );
    this.quote = await this.getSwapQuote(networkName, sellERC20Amount);

    const steps: Step[] = [
      new ApproveERC20SpenderStep(this.quote.spender, sellERC20Amount),
      new ZeroXV2SwapStep(this.quote, this.sellERC20Info),
    ];
    if (isDefined(this.destinationAddress)) {
      steps.push(
        this.isRailgunDestinationAddress === true
          ? new DesignateShieldERC20RecipientStep(this.destinationAddress, [
              this.buyERC20Info,
            ])
          : this.buyERC20Info.isBaseToken ?? false
          ? new TransferBaseTokenStep(this.destinationAddress)
          : new TransferERC20Step(this.destinationAddress, this.buyERC20Info),
      );
    }
    return steps;
  }
}
