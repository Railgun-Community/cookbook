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
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Borrow-only recipe against a Morpho Blue position the ephemeral EOA already
 * holds — the non-atomic 7702 payoff: the collateral was supplied in an earlier
 * `execute()` batch by the same EOA, and this batch draws (more) debt against
 * it, shielding the borrowed loan token.
 *
 * The executor identity MUST match the batch that opened the position, else
 * `onBehalf` points at an empty position and the borrow reverts. No unshield is
 * required — this recipe only produces borrowed tokens to shield.
 */
export class MorphoBlueBorrowRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Borrow',
    description: 'Borrows against an existing Morpho Blue collateral position.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_BORROW,
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
      'MorphoBlueBorrowRecipe recipient',
    );
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
      recipient: this.recipient,
      provider: this.provider,
    });
    return [new MorphoBlueBorrowStep(borrowQuote)];
  }
}
