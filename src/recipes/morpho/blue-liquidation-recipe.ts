import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueLiquidateStep } from '../../steps/morpho/blue-liquidate-step';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import { findFirstInputERC20Amount } from '../../utils/filters';

/**
 * Liquidate an unhealthy Morpho Blue borrower from the executing ephemeral EOA
 * (EIP-7702). The EOA is the liquidator (`msg.sender`): it repays debt with the
 * unshielded loan token and receives the seized collateral, which shields back.
 *
 * Seize-mode: seizes exactly `seizedCollateralAssets`. The exact loan pulled is
 * computed on-chain via the Morpho seize math; the recipe approves and spends a
 * conservative upper bound, and any unspent loan reshields. The caller must
 * unshield at least that bound (the quote's `maxRepaidAssets`).
 *
 * NOTE: `liquidate` takes no receiver/onBehalf — funds route through
 * `msg.sender`, which the 7702 batch sets to the ephemeral EOA. There is no
 * executor address to thread into the call.
 */
export class MorphoBlueLiquidationRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Liquidation',
    description: 'Liquidates an unhealthy borrower on a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW,
  };

  private readonly market: MarketParams;
  private readonly borrower: string;
  private readonly seizedCollateralAssets: bigint;
  private readonly slippageBasisPoints: bigint;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    borrower: string,
    seizedCollateralAssets: bigint,
    slippageBasisPoints: bigint,
    provider: Provider,
  ) {
    super();
    this.market = market;
    this.borrower = borrower;
    this.seizedCollateralAssets = seizedCollateralAssets;
    this.slippageBasisPoints = slippageBasisPoints;
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const quote = await MorphoBlueAPI.getLiquidationQuote({
      market: this.market,
      borrower: this.borrower,
      seizedCollateralAssets: this.seizedCollateralAssets,
      slippageBasisPoints: this.slippageBasisPoints,
      provider: this.provider,
    });

    // Ensure enough loan token was unshielded to cover the conservative repay.
    const loanInput = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      { tokenAddress: quote.loanToken, decimals: quote.loanDecimals },
    );
    if (loanInput.amount < quote.maxRepaidAssets) {
      throw new Error(
        `MorphoBlueLiquidationRecipe: unshielded loan ${loanInput.amount} < required ${quote.maxRepaidAssets}`,
      );
    }

    const loanInfo: RecipeERC20Info = {
      tokenAddress: quote.loanToken,
      decimals: quote.loanDecimals,
    };

    return [
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        loanInfo,
        quote.maxRepaidAssets,
      ),
      new MorphoBlueLiquidateStep(quote),
    ];
  }
}
