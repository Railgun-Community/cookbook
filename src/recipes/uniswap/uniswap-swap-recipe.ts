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
import { UniswapQuoteInputs, UniswapSwapQuoteData } from '../../models/uni-quote';
import { UniswapSwapStep } from '../../steps/swap/uniswap/uniswap-swap-step';
import { ContractTransaction } from 'ethers';

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
  ): Promise<UniswapSwapQuoteData> {

    const chain = NETWORK_CONFIG[networkName].chain;
    const recipientAddress = NETWORK_CONFIG[networkName].relayAdaptContract
    const quoteParams = UniswapQuote.getUniswapQuoteParams(
      chain,
      recipientAddress,
      quoteInputs,
    );

    const quoteResponse: {
      methodParameters: ContractTransaction,
      quoteDecimals: string,
      amountDecimals: string,
      quote: string,
      amount: string,
      route: any
    } = await UniswapQuote.getSwapQuote(quoteParams);

    const { methodParameters, quote, amount, amountDecimals, quoteDecimals } = quoteResponse;
    // parse the data into quoteDataResponse

    // TODO: Get buyToken decimal count.
    const buyDecimalHack = quoteResponse.route[0][0].tokenOut.decimals;

    const currentPriceEstimate = BigInt(quote) / BigInt(amount);

    const guaranteedPriceEsimtate = currentPriceEstimate - currentPriceEstimate * BigInt(this.slippageBasisPoints) / 10000n;

    const parsedDataResponse: UniswapSwapQuoteData = {
      sellTokenValue: '10000',
      spender: UniswapQuote.getUniswapPermit2ContractAddressForNetwork(networkName),
      crossContractCall: methodParameters as ContractTransaction,
      buyERC20Amount: {
        tokenAddress: quoteParams.tokenOut,
        decimals: BigInt(buyDecimalHack),
        amount: BigInt(quote),
      },
      minimumBuyAmount: 495n,
      sellTokenAddress: quoteParams.tokenIn,
      // Unused
      price: currentPriceEstimate,
      guaranteedPrice: 0n,
      slippageBasisPoints: 500n,
    };

    return parsedDataResponse;
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
      slippage: this.slippageBasisPoints,
      tokenInAmount: sellERC20Amount.amount.toString(10),
      tokenInAddress: sellERC20Amount.tokenAddress,
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
