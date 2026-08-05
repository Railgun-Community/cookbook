import {
  RecipePositionInfo,
  StepConfig,
  StepInput,
  StepOutputERC20Amount,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoWithdrawLoanQuote } from '../../api/morpho';

/**
 * Withdraws lent loan asset from a Morpho Blue market to the ephemeral EOA
 * (EIP-7702). Encodes Blue's `withdraw`, the lend-side counterpart to
 * `withdrawCollateral`.
 *
 * No ERC-20 input is consumed — the asset leaves the un-tokenized supply claim
 * and arrives at `receiver`. Any inputs pass through untouched.
 *
 * **Two denominations, and which one you get is decided by the quote.** An
 * assets-denominated withdrawal takes an exact number and is deterministic. A
 * shares-denominated one (`getWithdrawAllLoanQuote`) takes the whole claim
 * whatever interest has made it worth, so the realised assets drift UP between
 * building and inclusion. The step declares `expectedWithdrawnAssets` as the
 * expected balance with the same figure as the minimum — the drift is upward
 * only, and relay-adapt shields the executor's actual balance rather than the
 * declared number, so a better result is swept correctly regardless.
 *
 * **Failure semantics (7702).** Nothing is lost on failure — the claim stays
 * inside Blue keyed to `onBehalf` — but the position remains public and remains
 * there. The characteristic cause is not a health check but **free liquidity**:
 * lent assets are out on loan, and Blue reverts `InsufficientLiquidity` when
 * `totalSupplyAssets - totalBorrowAssets` is below the withdrawal. A fully
 * utilized market locks lenders out entirely. That revert is swallowed under
 * `requireSuccess = false`, so the batch mines having done nothing — which is
 * why the quote builder checks liquidity at build time rather than leaving it to
 * chain. See `steps/failure-modes.ts`.
 */
export class MorphoBlueWithdrawLoanStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Withdraw Loan Asset',
    description: 'Withdraws lent loan asset from a Morpho Blue market.',
  };

  private readonly quote: MorphoWithdrawLoanQuote;

  constructor(quote: MorphoWithdrawLoanQuote) {
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
      withdrawAssets,
      withdrawShares,
      expectedWithdrawnAssets,
      onBehalf,
      receiver,
    } = this.quote;

    // Blue requires exactly one of the two to be non-zero and reverts otherwise.
    // Checked here as well as in the builder because a quote is a plain object a
    // caller can hand-construct, and the on-chain failure is swallowed.
    const assetsMode = withdrawAssets > 0n;
    if (assetsMode === withdrawShares > 0n) {
      throw new Error(
        'MorphoBlueWithdrawLoanStep: exactly one of withdrawAssets / ' +
          `withdrawShares must be non-zero (got assets=${withdrawAssets}, ` +
          `shares=${withdrawShares})`,
      );
    }

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createWithdraw(
      params,
      withdrawAssets,
      withdrawShares,
      onBehalf,
      receiver,
    );

    const withdrawnLoan: StepOutputERC20Amount = {
      tokenAddress: loanToken,
      decimals: loanDecimals,
      // In shares mode this is what the claim is worth NOW; interest only pushes
      // it up. Declaring min === expected keeps the output deterministic for any
      // downstream step, and the epilogue shields the real balance either way.
      expectedBalance: expectedWithdrawnAssets,
      minBalance: expectedWithdrawnAssets,
      isBaseToken: false,
      approvedSpender: undefined,
    };

    const reducedSupply: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'supply',
      direction: 'decrease',
      tokenAddress: loanToken,
      decimals: loanDecimals,
      amount: expectedWithdrawnAssets,
      ...(assetsMode
        ? {}
        : {
            // A shares-mode exit retires the whole claim, and the assets figure
            // is an estimate of a number that grows until inclusion. Saying so
            // beats reporting a precise-looking figure that will be slightly low.
            estimateReason:
              'shares-denominated full withdrawal — realised assets accrue ' +
              'upward between build and inclusion',
          }),
    };

    return {
      crossContractCalls: [crossContractCall],
      outputERC20Amounts: [withdrawnLoan, ...input.erc20Amounts],
      outputNFTs: input.nfts,
      outputPositions: [reducedSupply],
    };
  }
}
