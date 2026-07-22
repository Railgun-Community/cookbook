import {
  RecipeAddLiquidityData,
  RecipeERC20AmountRecipient,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UniswapV2Fork,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils';
import { assertValidRecipientAddress } from '../../../utils/address';
import { Step } from '../../step';
import { UniV2LikeSDK } from '../../../api/uni-v2-like/uni-v2-like-sdk';
import { minBalanceAfterSlippage } from '../../../utils/number';
import { UniV2LikeRouterContract } from '../../../contract/liquidity/uni-v2-like-router-contract';

export class UniV2LikeAddLiquidityStep extends Step {
  readonly config: StepConfig = {
    name: '[Name] Add Liquidity',
    description: 'Adds liquidity to a [NAME] Pool.',
    hasNonDeterministicOutput: true,
  };

  private readonly uniswapV2Fork: UniswapV2Fork;

  private readonly addLiquidityData: RecipeAddLiquidityData;

  /**
   * EIP-7702 execution account: the ephemeral EOA the batch runs as. Minted LP
   * tokens are sent here (router `to`) instead of the shared relay-adapt contract.
   */
  private readonly recipient: string;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    addLiquidityData: RecipeAddLiquidityData,
    recipient: string,
  ) {
    super();
    this.uniswapV2Fork = uniswapV2Fork;
    this.addLiquidityData = addLiquidityData;
    assertValidRecipientAddress(recipient, 'UniV2 add-liquidity recipient');
    this.recipient = recipient;
    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Add Liquidity`;
    this.config.description = `Adds liquidity to a ${forkName} Pool.`;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;
    const {
      routerContractAddress,
      erc20AmountA,
      erc20AmountB,
      expectedLPAmount,
      slippageBasisPoints,
      deadlineTimestamp,
    } = this.addLiquidityData;

    const { erc20AmountsForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amounts(
        erc20Amounts,
        [
          erc20Amount =>
            compareERC20Info(erc20Amount, erc20AmountA) &&
            isApprovedForSpender(erc20Amount, routerContractAddress),
          erc20Amount =>
            compareERC20Info(erc20Amount, erc20AmountB) &&
            isApprovedForSpender(erc20Amount, routerContractAddress),
        ],
        {
          [erc20AmountA.tokenAddress]: erc20AmountA.amount,
          [erc20AmountB.tokenAddress]: erc20AmountB.amount,
        },
      );

    const validatedERC20AmountA = erc20AmountsForStep[0];
    const validatedERC20AmountB = erc20AmountsForStep[1];

    const minAmountA = minBalanceAfterSlippage(
      validatedERC20AmountA.expectedBalance,
      slippageBasisPoints,
    );
    const minAmountB = minBalanceAfterSlippage(
      validatedERC20AmountB.expectedBalance,
      slippageBasisPoints,
    );

    const contract = new UniV2LikeRouterContract(routerContractAddress);
    const crossContractCall = await contract.createAddLiquidity(
      validatedERC20AmountA.tokenAddress,
      validatedERC20AmountB.tokenAddress,
      validatedERC20AmountA.expectedBalance,
      validatedERC20AmountB.expectedBalance,
      minAmountA,
      minAmountB,
      this.recipient,
      deadlineTimestamp,
    );

    const lpRecipient = UniV2LikeSDK.getLPName(this.uniswapV2Fork);
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
      slippageBasisPoints,
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
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [
        spendERC20AmountRecipientA,
        spendERC20AmountRecipientB,
      ],
      outputERC20Amounts: [outputLPERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
