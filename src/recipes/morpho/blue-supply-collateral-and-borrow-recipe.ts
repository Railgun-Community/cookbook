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
  PositionOwner,
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
} from '../../utils/7702';
import { findFirstInputERC20Amount } from '../../utils/filters';

/**
 * Open a Morpho Blue position in one batch: supply the unshielded collateral,
 * then borrow loan tokens against it. The borrowed tokens are delivered to the
 * executing ephemeral EOA (EIP-7702) and shielded from it. Positions are
 * un-tokenized; only the borrowed loan token (and any collateral change)
 * shields back.
 *
 * Self-contained: reads market token decimals on-chain via {@link MorphoBlueAPI}
 * and validates the accounts. The caller passes the market, the borrow amount,
 * an executor, and a provider; the collateral amount comes from the unshielded
 * input. Borrowing reverts if it would exceed the market LLTV.
 *
 * `owner` defaults to the executor. Passing it explicitly supplies collateral
 * to, and borrows against, a durable owner — which requires the owner to have
 * authorised the executor on Morpho (preflighted at quote time). Note the
 * asymmetry: the supply leg needs no authorization, so a wrong `owner` here
 * hands collateral to that account irrecoverably.
 */
export class MorphoBlueSupplyCollateralAndBorrowRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Supply Collateral + Borrow',
    description: 'Supplies collateral and borrows against it in a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW,
  };

  private readonly market: MarketParams;
  private readonly borrowAssets: bigint;
  private readonly executor: string;
  private readonly owner: string;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    borrowAssets: bigint,
    executor: EphemeralExecutor | string,
    provider: Provider,
    owner?: PositionOwner,
  ) {
    super();
    this.market = market;
    this.borrowAssets = borrowAssets;
    this.executor = resolveExecutorAddress(
      executor,
      'MorphoBlueSupplyCollateralAndBorrowRecipe executor',
    );
    this.owner =
      owner === undefined
        ? this.executor
        : resolvePositionOwnerAddress(
            owner,
            'MorphoBlueSupplyCollateralAndBorrowRecipe owner',
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
      owner: this.owner,
      provider: this.provider,
    });
    const collateralInfo: RecipeERC20Info = {
      tokenAddress: this.market.collateralToken,
      decimals: supplyQuote.collateralDecimals,
    };

    const borrowQuote = await MorphoBlueAPI.getBorrowQuote({
      market: this.market,
      borrowAssets: this.borrowAssets,
      owner: this.owner,
      receiver: this.executor,
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
