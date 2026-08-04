import {
  RecipePositionInfo,
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
 *
 * **Failure semantics (7702).** Safe to fail, dangerous to half-finish. A failed
 * borrow draws no debt and produces no token, and the batch reshields everything.
 * A SUCCESSFUL borrow followed by a later failure splits in two: the loan token is
 * a declared output at the executor and IS swept back shielded, while the DEBT is
 * booked against `onBehalf` inside Blue and is not — it stays, accrues, and can be
 * liquidated by anyone at any time with no wallet involvement. Read it back with
 * `MorphoBlueAPI.getPositionRisk`. See `steps/failure-modes.ts`.
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
    const {
      params,
      marketId,
      loanToken,
      loanDecimals,
      borrowAssets,
      onBehalf,
      receiver,
    } = this.quote;

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

    // The debt is booked against `onBehalf`, NOT `receiver`. Morpho's `borrow`
    // takes both and only the first carries the liability; the shipped builders
    // resolve one executor into both, so they are equal today. If they ever
    // diverge, the loan token lands with `receiver` (the ERC20 output above)
    // while the obligation stays with `onBehalf` (this record) — mixing them up
    // would attribute a debt to whoever was paid.
    //
    // Deterministic and fee-free at this instant: a Blue market's `fee` is
    // taken out of ACCRUED INTEREST (as fee shares to the fee recipient — see
    // `accrueMorphoBlueInterest`), never out of the principal, so the debt goes
    // up by exactly `borrowAssets` and grows from there with interest.
    const borrowedDebt: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'debt',
      direction: 'increase',
      tokenAddress: loanToken,
      decimals: loanDecimals,
      amount: borrowAssets,
    };

    return {
      crossContractCalls: [crossContractCall],
      // Borrow produces new loan tokens; existing inputs pass through unchanged.
      outputERC20Amounts: [borrowedLoanToken, ...input.erc20Amounts],
      outputNFTs: input.nfts,
      outputPositions: [borrowedDebt],
    };
  }
}
