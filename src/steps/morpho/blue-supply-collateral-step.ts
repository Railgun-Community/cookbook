import {
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
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
 * — there is no ERC-20 output for it. Pure step consuming a
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
    const { params, collateralToken, collateralDecimals, collateralAssets, onBehalf } =
      this.quote;

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
      amount: collateralAssets,
      recipient: 'Morpho Blue Market',
    };

    return {
      crossContractCalls: [crossContractCall],
      spentERC20Amounts: [spentCollateral],
      // Collateral becomes an un-tokenized position; only change passes through.
      outputERC20Amounts: unusedERC20Amounts,
      outputNFTs: input.nfts,
    };
  }
}
