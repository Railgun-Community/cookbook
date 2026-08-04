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
import { MorphoSupplyCollateralQuote } from '../../api/morpho';
import { MORPHO_BLUE_ADDRESS } from './morpho-blue-util';

/**
 * Supplies collateral into a Morpho Blue market on behalf of the ephemeral EOA
 * (EIP-7702). The collateral becomes an un-tokenized position keyed by the EOA
 * — there is no ERC-20 or NFT output for it, so the position it creates is
 * declared in `outputPositions`. Pure step consuming a
 * {@link MorphoSupplyCollateralQuote}.
 */
export class MorphoBlueSupplyCollateralStep extends Step {
  readonly config: StepConfig = {
    name: 'Morpho Blue Supply Collateral',
    description: 'Supplies collateral into a Morpho Blue market.',
  };

  private readonly quote: MorphoSupplyCollateralQuote;

  constructor(quote: MorphoSupplyCollateralQuote) {
    super();
    this.quote = quote;
  }

  protected async getStepOutput(
    input: StepInput,
  ): Promise<UnvalidatedStepOutput> {
    const {
      params,
      marketId,
      collateralToken,
      collateralDecimals,
      collateralAssets,
      onBehalf,
    } = this.quote;

    const collateralInfo: RecipeERC20Info = {
      tokenAddress: collateralToken,
      decimals: collateralDecimals,
    };
    const { unusedERC20Amounts } = this.getValidInputERC20Amount(
      input.erc20Amounts,
      erc20Amount =>
        compareERC20Info(erc20Amount, collateralInfo) &&
        isApprovedForSpender(erc20Amount, MORPHO_BLUE_ADDRESS),
      collateralAssets,
    );

    const contract = new MorphoBlueContract();
    const crossContractCall = await contract.createSupplyCollateral(
      params,
      collateralAssets,
      onBehalf,
    );

    const spentCollateral: RecipeERC20AmountRecipient = {
      ...collateralInfo,
      // `recipient` here is a human label, not an address — the collateral does
      // not go to a recipient, it becomes position state. The position record
      // below is what actually names where it went.
      amount: collateralAssets,
      recipient: 'Morpho Blue Market',
    };

    // Blue charges nothing on supplyCollateral: `Morpho.supplyCollateral`
    // credits `position[id][onBehalf].collateral += assets` with the same
    // `assets` it pulls, so the caller-facing and position-facing figures
    // coincide. (They do not on f(x) — see the channel docs in export-models.)
    const suppliedCollateral: RecipePositionInfo = {
      protocol: 'morpho-blue',
      marketOrPoolId: marketId,
      custody: 'address-bound',
      owner: onBehalf,
      kind: 'collateral',
      direction: 'increase',
      tokenAddress: collateralToken,
      decimals: collateralDecimals,
      amount: collateralAssets,
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentCollateral],
      // Collateral becomes an un-tokenized position; only change passes through.
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
      outputPositions: [suppliedCollateral],
    };
  }
}
