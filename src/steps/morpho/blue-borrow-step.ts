import {
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoBorrowQuote } from '../../api/morpho';

/**
 * Borrows loan tokens from a Morpho Blue market against the ephemeral EOA's
 * existing collateral position (EIP-7702), routing the borrowed tokens to that
 * EOA (`receiver`). No ERC-20 input is consumed — this only draws debt; the
 * borrowed amount is deterministic. Any inputs pass through untouched.
 *
 * Non-atomic: the collateral may have been supplied in an earlier `execute()`
 * batch by the same EOA. The executor identity MUST match, else `onBehalf`
 * points at an empty position and the borrow reverts.
 */
export class MorphoBlueBorrowStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Borrow',
    description: 'Borrows loan tokens from a Morpho Blue market.',
  };

  private readonly quote: MorphoBorrowQuote;

  constructor(quote: MorphoBorrowQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { params, loanToken, loanDecimals, borrowAssets, onBehalf, receiver } =
      this.quote;

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createBorrow(
      params,
      borrowAssets,
      onBehalf,
      receiver,
    );

    const borrowedLoanToken: StepOutputERC20Amount = {
      tokenAddress: loanToken,
      decimals: loanDecimals,
      expectedBalance: borrowAssets,
      minBalance: borrowAssets,
      approvedSpender: undefined,
    };

    return {
      crossContractCalls: [crossContractCall],
      // Borrow produces new loan tokens; existing inputs pass through unchanged.
      outputERC20Amounts: [borrowedLoanToken, ...input.erc20Amounts],
      outputNFTs: input.nfts,
    };
  }
}
