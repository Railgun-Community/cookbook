import {
  RecipeRemoveLiquidityData,
  RecipeERC20AmountRecipient,
  StepInput,
  StepOutputERC20Amount,
  UniswapV2Fork,
  UnvalidatedStepOutput,
  StepConfig,
} from '../../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../../utils';
import { assertValidRecipientAddress } from '../../../utils/address';
import { Step } from '../../step';
import { UniV2LikeSDK } from '../../../api/uni-v2-like/uni-v2-like-sdk';
import { minBalanceAfterSlippage } from '../../../utils/number';
import { UniV2LikeRouterContract } from '../../../contract/liquidity/uni-v2-like-router-contract';

/**
 * **Failure semantics (7702).** Benign in both directions: on failure the LP
 * token is untouched at the executor and reshields; on success both underlying
 * tokens are declared outputs and reshield. See `steps/failure-modes.ts`.
 */
export class UniV2LikeRemoveLiquidityStep extends Step {
  readonly config: StepConfig = {
    name: '[Name] Remove Liquidity',
    description: 'Removes liquidity from a [NAME] Pool.',
    hasNonDeterministicOutput: true,
  };

  private readonly uniswapV2Fork: UniswapV2Fork;

  private readonly removeLiquidityData: RecipeRemoveLiquidityData;

  /**
   * EIP-7702 execution account: the ephemeral EOA the batch runs as. Withdrawn
   * tokens are sent here (router `to`) instead of the shared relay-adapt contract.
   */
  private readonly recipient: string;

  constructor(
    uniswapV2Fork: UniswapV2Fork,
    removeLiquidityData: RecipeRemoveLiquidityData,
    recipient: string,
  ) {
    super();
    this.uniswapV2Fork = uniswapV2Fork;
    this.removeLiquidityData = removeLiquidityData;
    assertValidRecipientAddress(recipient, 'UniV2 remove-liquidity recipient');
    this.recipient = recipient;
    const forkName = UniV2LikeSDK.getForkName(uniswapV2Fork);
    this.config.name = `${forkName} Remove Liquidity`;
    this.config.description = `Removes liquidity from a ${forkName} Pool.`;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { erc20Amounts } = input;
    const {
      routerContractAddress,
      lpERC20Amount,
      expectedERC20AmountA,
      expectedERC20AmountB,
      slippageBasisPoints,
      deadlineTimestamp,
    } = this.removeLiquidityData;

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, lpERC20Amount) &&
          isApprovedForSpender(erc20Amount, routerContractAddress),
        lpERC20Amount.amount,
      );

    const minAmountA = minBalanceAfterSlippage(
      expectedERC20AmountA.amount,
      slippageBasisPoints,
    );
    const minAmountB = minBalanceAfterSlippage(
      expectedERC20AmountB.amount,
      slippageBasisPoints,
    );

    const contract = new UniV2LikeRouterContract(routerContractAddress);
    const crossContractCall = await contract.createRemoveLiquidity(
      expectedERC20AmountA.tokenAddress,
      expectedERC20AmountB.tokenAddress,
      erc20AmountForStep.expectedBalance,
      minAmountA,
      minAmountB,
      this.recipient,
      deadlineTimestamp,
    );

    const lpRecipient = UniV2LikeSDK.getLPName(this.uniswapV2Fork);
    const spendERC20AmountRecipient: RecipeERC20AmountRecipient = {
      tokenAddress: erc20AmountForStep.tokenAddress,
      decimals: erc20AmountForStep.decimals,
      amount: erc20AmountForStep.expectedBalance,
      recipient: lpRecipient,
    };

    const outputERC20AmountA: StepOutputERC20Amount = {
      tokenAddress: expectedERC20AmountA.tokenAddress,
      decimals: expectedERC20AmountA.decimals,
      isBaseToken: false,
      expectedBalance: expectedERC20AmountA.amount,
      minBalance: minAmountA,
      approvedSpender: undefined,
    };
    const outputERC20AmountB: StepOutputERC20Amount = {
      tokenAddress: expectedERC20AmountB.tokenAddress,
      decimals: expectedERC20AmountB.decimals,
      isBaseToken: false,
      expectedBalance: expectedERC20AmountB.amount,
      minBalance: minAmountB,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spendERC20AmountRecipient],
      outputERC20Amounts: [
        outputERC20AmountA,
        outputERC20AmountB,
        ...unusedERC20Amounts,
      ],
      outputNFTs: input.nfts,
    };
  }
}
