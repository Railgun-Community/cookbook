import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
  RecipePositionInfo,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { compareERC20Info, isApprovedForSpender } from '../../utils/token';
import { Step } from '../step';
import { MorphoBlueContract } from '../../contract/morpho/morpho-blue-contract';
import { MorphoSupplyLoanQuote } from '../../api/morpho';
import { MORPHO_BLUE_ADDRESS } from './morpho-blue-util';

/**
 * Lends the loan asset into a Morpho Blue market on behalf of the ephemeral EOA
 * (EIP-7702), earning `supplyShares`. Encodes Blue's `supply`, not
 * `supplyCollateral` — this is the lend side, which had no step at all until
 * now, so lending was unreachable from the cookbook even though the ABI carried
 * the function.
 *
 * Like collateral, the claim is un-tokenized: there is no ERC-20 or NFT output
 * for it, so what it creates is declared in `outputPositions` with
 * `kind: 'supply'`.
 *
 * **The position is denominated in SHARES, not assets, and that is the
 * difference from collateral.** Collateral sits inert — `supplyCollateral`
 * credits the same number it pulls, so the caller-facing and position-facing
 * figures coincide. A supply claim grows with borrower interest, so the assets
 * declared here are what was lent at build time and the position is worth more
 * later. Anything reading the position back must convert via
 * `supplyAssetsForShares`, not remember this number.
 *
 * **Failure semantics (7702).** Identical in shape to
 * {@link MorphoBlueSupplyCollateralStep}: a FAILED supply leaves the loan token
 * at the executor for the shield epilogue to sweep — a clean no-op. A SUCCESSFUL
 * supply followed by a later failure leaves the claim as
 * `position[id][onBehalf].supplyShares` inside the Blue singleton, which the
 * epilogue cannot sweep and this batch cannot re-privatise. Recovery is a second
 * batch running as (or authorized by) `onBehalf`; the association between that
 * address and the position is public and permanent. See
 * `steps/failure-modes.ts`.
 */
export class MorphoBlueSupplyLoanStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Supply Loan Asset',
    description: 'Lends the loan asset into a Morpho Blue market.',
  };

  private readonly quote: MorphoSupplyLoanQuote;

  constructor(quote: MorphoSupplyLoanQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const { params, marketId, loanToken, loanDecimals, supplyAssets, onBehalf } =
      this.quote;

    const loanInfo: RecipeERC20Info = {
      tokenAddress: loanToken,
      decimals: loanDecimals,
    };
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      input.erc20Amounts,
      erc20Amount =>
        compareERC20Info(erc20Amount, loanInfo) &&
        isApprovedForSpender(erc20Amount, MORPHO_BLUE_ADDRESS),
      supplyAssets,
    );

    const contract = new MorphoBlueContract();
    // Assets-denominated: shares = 0. Blue requires exactly one to be non-zero,
    // and a caller lending a known amount thinks in assets.
    const crossContractCall = await contract.createSupply(
      params,
      supplyAssets,
      0n,
      onBehalf,
    );

    const spentLoan: RecipeERC20AmountRecipient = {
      ...loanInfo,
      // A human label, not an address: the asset does not go to a recipient, it
      // becomes position state. The position record below names where it went.
      amount: supplyAssets,
      recipient: 'Morpho Blue Market',
    };

    const suppliedLoan: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'supply',
      direction: 'increase',
      tokenAddress: loanToken,
      decimals: loanDecimals,
      amount: supplyAssets,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentLoan],
      // The lent asset becomes an un-tokenized claim; only change passes through.
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
      outputPositions: [suppliedLoan],
    };
  }
}
