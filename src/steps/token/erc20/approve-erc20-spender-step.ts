import {
  RecipeERC20Info,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../../models/export-models';
import { Step } from '../../step';
import { ERC20Contract } from '../../../contract/token/erc20-contract';
import { compareERC20Info } from '../../../utils/token';
import { createNoActionStepOutput } from '../../../utils/no-action-output';
import {
  maxBigNumberForTransaction,
  minBigNumber,
} from '../../../utils/big-number';
import { NetworkName, isDefined } from '@railgun-community/shared-models';
import { ContractTransaction } from 'ethers';

export class ApproveERC20SpenderStep extends Step {
  readonly config: StepConfig = {
    name: 'Approve ERC20 Spender',
    description: 'Approves ERC20 for spender contract.',
  };

  private readonly spender: Optional<string>;
  private readonly tokenInfo: RecipeERC20Info;
  private readonly amount: Optional<bigint>;

  constructor(
    spender: Optional<string>,
    tokenInfo: RecipeERC20Info,
    amount?: bigint,
  ) {
    super();
    this.spender = spender;
    this.tokenInfo = tokenInfo;
    this.amount = amount;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    if (!isDefined(this.spender) || (this.tokenInfo.isBaseToken ?? false)) {
      return createNoActionStepOutput(input);
    }

    const { erc20Amounts, networkName } = input;

    const { erc20AmountForStep, unusedERC20Amounts } =
      this.getValidInputERC20Amount(
        erc20Amounts,
        erc20Amount =>
          compareERC20Info(erc20Amount, this.tokenInfo) &&
          erc20Amount.approvedSpender !== this.spender,
        this.amount,
      );

    const contract = new ERC20Contract(erc20AmountForStep.tokenAddress);
    const approveAmount = this.amount ?? maxBigNumberForTransaction();

    const crossContractCalls: ContractTransaction[] = [];

    if (
      this.requiresClearApprovalTransaction(
        networkName,
        erc20AmountForStep.tokenAddress,
      )
    ) {
      crossContractCalls.push(
        await contract.createSpenderApproval(this.spender, 0n),
      );
    }

    crossContractCalls.push(
      await contract.createSpenderApproval(this.spender, approveAmount),
    );
    const approvedERC20Amount: StepOutputERC20Amount = {
      tokenAddress: erc20AmountForStep.tokenAddress,
      decimals: erc20AmountForStep.decimals,
      isBaseToken: erc20AmountForStep.isBaseToken,
      expectedBalance: minBigNumber(
        approveAmount,
        erc20AmountForStep.expectedBalance,
      ),
      minBalance: minBigNumber(approveAmount, erc20AmountForStep.minBalance),
      approvedSpender: this.spender,
    };

    return {
      crossContractCalls,
      outputERC20Amounts: [approvedERC20Amount, ...unusedERC20Amounts],
      outputNFTs: input.nfts,
    };
  }

  /**
   * Certain tokens require a clear approval transaction before approving a new spender.
   */
  private requiresClearApprovalTransaction(
    networkName: NetworkName,
    tokenAddress: string,
  ): boolean {
    switch (networkName) {
      case NetworkName.Ethereum:
        if (
          [
            '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
          ].includes(tokenAddress.toLowerCase())
        ) {
          return true;
        }
        return false;
      case NetworkName.Railgun:
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.Arbitrum:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
        return false;
    }
  }
}
