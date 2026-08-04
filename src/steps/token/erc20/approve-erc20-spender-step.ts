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

/**
 * **Failure semantics (7702).** A failed approve cascades harmlessly: the
 * protocol call that needed the allowance also fails, and the batch degrades into
 * a no-op with everything reshielded. A SUCCESSFUL approve is what persists — the
 * allowance survives a failed batch and the shield epilogue cannot sweep an
 * allowance. Note `approveAmount = amount ?? maxBigNumberForTransaction()`, so the
 * call sites that omit the amount (`ZeroXV2SwapRecipe`, and the f(x) open /
 * top-up recipes) leave an UNLIMITED allowance behind — a standing grant, not a
 * per-batch artifact, on a reusable executor. See `steps/failure-modes.ts`.
 */
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
    // Half the shipped call sites pass no `amount`, and this used to fall
    // straight through to an unlimited approval for all of them. That is a
    // standing grant on a live spender: the shield epilogue sweeps balances, not
    // allowances, so it outlives the batch that created it. Under 7702 the
    // grantor is a single-use account nobody is watching afterwards.
    //
    // Those call sites omit the amount because they cannot pass one — supplying
    // it makes `getValidInputERC20Amount` throw whenever the input is
    // non-deterministic (see step.ts). But omitting the ARGUMENT never meant the
    // approval had to be unbounded: when the input is deterministic
    // (`minBalance === expectedBalance`, which is the case whenever the token
    // arrives straight from an unshield) the exact figure is known right here.
    //
    // Unlimited survives only where the balance genuinely is not known until
    // execution, because a downstream that pulls the whole runtime balance
    // (Beefy `depositAll`) would fail against a short approval if the fill beats
    // the quote. That residue is asserted rather than silent —
    // `assertExecutorResidue` classifies it under `allowance`.
    const approveAmount =
      this.amount ??
      (erc20AmountForStep.minBalance === erc20AmountForStep.expectedBalance
        ? erc20AmountForStep.expectedBalance
        : maxBigNumberForTransaction());

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
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.Arbitrum:
      case NetworkName.EthereumSepolia:
      case NetworkName.Hardhat:
      case NetworkName.PolygonAmoy:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli_DEPRECATED:
      case NetworkName.PolygonMumbai_DEPRECATED:
      case NetworkName.ArbitrumGoerli_DEPRECATED:
        return false;
    }
  }
}
