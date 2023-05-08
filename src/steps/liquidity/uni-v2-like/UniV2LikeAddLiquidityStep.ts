import {
  RecipeAddLiquidityData,
  RecipeERC20AmountRecipient,
  StepInput,
  StepOutputERC20Amount,
  UniswapV2Fork,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils';
import { Step } from '../../step';
import { UniV2LikeSDK } from '../../../api/uniswap/uni-v2-like-sdk';
import { minBalanceAfterSlippage } from '../../../utils/number';
import { UniV2LikeRouterContract } from '../../../contract/liquidity/uni-v2-like-router-contract';
import { NETWORK_CONFIG } from '@railgun-community/shared-models';

export class UniV2LikeAddLiquidityStep extends Step {
  readonly config = {
    name: '[Name] Add Liquidity Step',
    description: 'Adds liquidity to a Uniswap V2-like pair.',
    hasNonDeterministicOutput: true,
  };

  private readonly uniswapV2Fork: UniswapV2Fork;

  private readonly addLiquidityData: RecipeAddLiquidityData;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    addLiquidityData: RecipeAddLiquidityData,
  ) {
    super();
    this.uniswapV2Fork = uniswapV2Fork;
    this.addLiquidityData = addLiquidityData;
    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Add Liquidity Step`;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;
    const {
      routerContract,
      erc20AmountA,
      erc20AmountB,
      expectedLPAmount,
      slippagePercentage,
      deadlineTimestamp,
    } = this.addLiquidityData;

    const { erc20AmountsForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amounts(
        erc20Amounts,
        [
          erc20Amount =>
            compareERC20Info(erc20Amount, erc20AmountA) &&
            isApprovedForSpender(erc20Amount, routerContract),
          erc20Amount =>
            compareERC20Info(erc20Amount, erc20AmountB) &&
            isApprovedForSpender(erc20Amount, routerContract),
        ],
        [erc20AmountA.amount, erc20AmountB.amount],
      );

    const validatedERC20AmountA = erc20AmountsForStep[0];
    const validatedERC20AmountB = erc20AmountsForStep[1];

    const minAmountA = minBalanceAfterSlippage(
      validatedERC20AmountA.expectedBalance,
      slippagePercentage,
    );
    const minAmountB = minBalanceAfterSlippage(
      validatedERC20AmountB.expectedBalance,
      slippagePercentage,
    );

    const { relayAdaptContract } = NETWORK_CONFIG[input.networkName];

    const contract = new UniV2LikeRouterContract(routerContract);
    const populatedTransaction = await contract.createAddLiquidity(
      validatedERC20AmountA.tokenAddress,
      validatedERC20AmountB.tokenAddress,
      validatedERC20AmountA.expectedBalance,
      validatedERC20AmountB.expectedBalance,
      minAmountA,
      minAmountB,
      relayAdaptContract,
      deadlineTimestamp,
    );

    const lpRecipient = UniV2LikeSDK.getPairName(
      this.uniswapV2Fork,
      erc20AmountA,
      erc20AmountB,
    );

    const spendERC20AmountRecipientA: RecipeERC20AmountRecipient = {
      tokenAddress: validatedERC20AmountA.tokenAddress,
      decimals: validatedERC20AmountA.decimals,
      amount: validatedERC20AmountA.expectedBalance,
      recipient: lpRecipient,
    };
    const spendERC20AmountRecipientB: RecipeERC20AmountRecipient = {
      tokenAddress: validatedERC20AmountB.tokenAddress,
      decimals: validatedERC20AmountB.decimals,
      amount: validatedERC20AmountB.expectedBalance,
      recipient: lpRecipient,
    };

    const minLPBalance = minBalanceAfterSlippage(
      expectedLPAmount.amount,
      slippagePercentage,
    );

    const outputLPERC20Amount: StepOutputERC20Amount = {
      tokenAddress: expectedLPAmount.tokenAddress,
      decimals: expectedLPAmount.decimals,
      isBaseToken: false,
      expectedBalance: expectedLPAmount.amount,
      minBalance: minLPBalance,
      approvedSpender: undefined,
    };

    return {
      populatedTransactions: [populatedTransaction],
      spentERC20Amounts: [
        spendERC20AmountRecipientA,
        spendERC20AmountRecipientB,
      ],
      outputERC20Amounts: [outputLPERC20Amount, ...unusedERC20Amounts],
      spentNFTs: [],
      outputNFTs: input.nfts,
      feeERC20AmountRecipients: [],
    };
  }
}
