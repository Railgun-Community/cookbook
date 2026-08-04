import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { MorphoBlueBorrowStep } from '../../steps/morpho/blue-borrow-step';
import { MarketParams } from '../../steps/morpho/morpho-blue-util';
import { RecipeConfig, StepInput } from '../../models/export-models';
import { MIN_GAS_LIMIT_MORPHO_BLUE_BORROW } from '../../models/min-gas-limits';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
} from '../../utils/7702';

/**
 * Borrow-only recipe against a Morpho Blue position that already exists — the
 * non-atomic 7702 payoff: the collateral was supplied in an earlier `execute()`
 * batch, and this batch draws (more) debt against it, shielding the borrowed
 * loan token. No unshield is required.
 *
 * `executor` is the account this batch runs as; the borrowed loan token is
 * delivered to it and shielded from it.
 *
 * `owner` is the account the debt is booked against. It defaults to `executor`
 * — the self-custody case, where the identity MUST match the batch that opened
 * the position, else `onBehalf` points at an empty position. Pass it
 * explicitly to borrow against a durable owner's collateral; the owner must
 * have authorised the executor on Morpho first, which
 * {@link MorphoBlueAPI.getBorrowQuote} preflights.
 */
export class MorphoBlueBorrowRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Borrow',
    description: 'Borrows against an existing Morpho Blue collateral position.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_BORROW,
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
      'MorphoBlueBorrowRecipe executor',
    );
    this.owner =
      owner === undefined
        ? this.executor
        : resolvePositionOwnerAddress(owner, 'MorphoBlueBorrowRecipe owner');
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    // Borrow-only: no unshielded input is consumed (runs with skipUnshield);
    // the step just draws debt against the EOA's existing position.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const borrowQuote = await MorphoBlueAPI.getBorrowQuote({
      market: this.market,
      borrowAssets: this.borrowAssets,
      owner: this.owner,
      receiver: this.executor,
      provider: this.provider,
    });
    return [new MorphoBlueBorrowStep(borrowQuote)];
  }
}
