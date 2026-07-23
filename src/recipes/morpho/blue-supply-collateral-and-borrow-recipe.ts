import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueSupplyCollateralStep } from '../../steps/morpho/blue-supply-collateral-step';
import { MorphoBlueBorrowStep } from '../../steps/morpho/blue-borrow-step';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';
import {
  RecipeConfig,
  RecipeERC20Info,
  StepInput,
} from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';
import { findFirstInputERC20Amount } from '../../utils/filters';

/**
 * Open a Morpho Blue position in one batch: supply the unshielded collateral,
 * then borrow loan tokens against it — all on behalf of the executing ephemeral
 * EOA (EIP-7702), which receives the borrowed tokens. Positions are un-tokenized;
 * only the borrowed loan token (and any collateral change) shields back.
 *
 * Self-contained: reads market token decimals on-chain via {@link MorphoBlueAPI}
 * and validates the 7702 executor. The caller passes the market, the borrow
 * amount, an executor, and a provider; the collateral amount comes from the
 * unshielded input. Borrowing reverts if it would exceed the market LLTV.
 */
export class MorphoBlueSupplyCollateralAndBorrowRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Supply Collateral + Borrow',
    description: 'Supplies collateral and borrows against it in a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW,
  };

  private readonly market: MarketParams;
  private readonly borrowAssets: bigint;
  private readonly recipient: string;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    borrowAssets: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super();
    this.market = market;
    this.borrowAssets = borrowAssets;
    this.recipient = resolveExecutorAddress(
      recipient,
      'MorphoBlueSupplyCollateralAndBorrowRecipe recipient',
    );
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    // Collateral amount comes from the unshielded input (matched by address;
    // compareERC20Info ignores decimals).
    const collateralInput = findFirstInputERC20Amount(
      firstInternalStepInput.erc20Amounts,
      { tokenAddress: this.market.collateralToken, decimals: 0n },
    );

    const supplyQuote = await MorphoBlueAPI.getSupplyCollateralQuote({
      market: this.market,
      collateralAssets: collateralInput.amount,
      recipient: this.recipient,
      provider: this.provider,
    });
    const collateralInfo: RecipeERC20Info = {
      tokenAddress: this.market.collateralToken,
      decimals: supplyQuote.collateralDecimals,
    };

    const borrowQuote = await MorphoBlueAPI.getBorrowQuote({
      market: this.market,
      borrowAssets: this.borrowAssets,
      recipient: this.recipient,
      provider: this.provider,
    });

    return [
      // Exact-amount approval to the Blue singleton only; supplyCollateral
      // consumes it in full → no residual allowance on the ephemeral account.
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        collateralInfo,
        supplyQuote.collateralAssets,
      ),
      new MorphoBlueSupplyCollateralStep(supplyQuote),
      new MorphoBlueBorrowStep(borrowQuote),
    ];
  }
}
