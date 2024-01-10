import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { Step } from '../../steps/step';
import { ZeroXQuote } from '../../api/zero-x/zero-x-quote';
import { ZeroXSwapStep } from '../../steps/swap/zero-x/zero-x-swap-step';
import {
  RecipeConfig,
  RecipeERC20Amount,
  RecipeERC20Info,
  StepInput,
  SwapQuoteData,
} from '../../models/export-models';
import { UniswapSwapRecipeCore } from './swap-recipe';
import { NETWORK_CONFIG, NetworkName, isDefined } from '@railgun-community/shared-models';
import {
  findFirstInputERC20Amount,
  getIsUnvalidatedRailgunAddress,
} from '../../utils';
import {
  MIN_GAS_LIMIT_0X_SWAP,
  MIN_GAS_LIMIT_0X_SWAP_SHIELD,
  MIN_GAS_LIMIT_0X_SWAP_TRANSFER,
} from '../../models/min-gas-limits';
import { TransferERC20Step } from '../../steps';
import { DesignateShieldERC20RecipientStep } from '../../steps/railgun/designate-shield-erc20-recipient-step';
import { UniswapQuote } from '../../api/uni-quote/uni-quote';
import { UniswapQuoteInputs } from '../../models/uni-quote';
import { UniswapSwapStep } from '../../steps/swap/uniswap/uniswap-swap-step';

export class UniswapSwapRecipe extends UniswapSwapRecipeCore {
  readonly config: RecipeConfig = {
    name: 'Uniswap Exchange Swap',
    description: 'Swaps two ERC20 tokens using Uniswap Exchange.',
    minGasLimit: MIN_GAS_LIMIT_0X_SWAP,
  };

  protected readonly sellERC20Info: RecipeERC20Info;
  protected readonly buyERC20Info: RecipeERC20Info;

  private readonly slippageBasisPoints: bigint;

  protected readonly destinationAddress: Optional<string>;
  protected readonly isRailgunDestinationAddress: Optional<boolean>;
  protected readonly quoter: UniswapQuote;
  constructor(
    sellERC20Info: RecipeERC20Info,
    buyERC20Info: RecipeERC20Info,
    slippageBasisPoints: bigint,
    destinationAddress?: string,
  ) {
    super();

    this.sellERC20Info = sellERC20Info;
    this.buyERC20Info = buyERC20Info;

    this.slippageBasisPoints = slippageBasisPoints;
    this.quoter = new UniswapQuote();
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
    return ZeroXQuote.supportsNetwork(networkName);
  }

  async getSwapQuote(
    networkName: NetworkName,
    quoteInputs: UniswapQuoteInputs
  ): Promise<SwapQuoteData> {

    const chain = NETWORK_CONFIG[networkName].chain;
    const recipientAddress = NETWORK_CONFIG[networkName].relayAdaptContract
    const quoteParams = this.quoter.getUniswapQuoteParams(
      chain,
      recipientAddress,
      quoteInputs,
    );

    return this.quoter.fetchUniswapQuote(quoteParams);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const { networkName } = firstInternalStepInput;
    const sellERC20Amount = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      this.sellERC20Info,
    );

    const quoteInputs: UniswapQuoteInputs = {
      slippage: 5,
      tokenInAmount: '0',
      tokenInAddress: this.sellERC20Info.tokenAddress,
      tokenOutAddress: this.buyERC20Info.tokenAddress,
    }

    this.quote = await this.getSwapQuote(networkName, quoteInputs);

    const steps: Step[] = [
      new ApproveERC20SpenderStep(this.quote.spender, sellERC20Amount),
      new UniswapSwapStep(this.quote, this.sellERC20Info),
    ];
    if (isDefined(this.destinationAddress)) {
      steps.push(
        this.isRailgunDestinationAddress === true
          ? new DesignateShieldERC20RecipientStep(this.destinationAddress, [
            this.buyERC20Info,
          ])
          : new TransferERC20Step(this.destinationAddress, this.buyERC20Info),
      );
    }
    return steps;
  }
}
