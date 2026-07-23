import { Provider } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { Recipe } from '../recipe';
import { Step } from '../../steps/step';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueRepaySharesStep } from '../../steps/morpho/blue-repay-shares-step';
import { MorphoBlueWithdrawCollateralStep } from '../../steps/morpho/blue-withdraw-collateral-step';
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
import {
  EphemeralExecutor,
  resolveExecutorAddress,
} from '../../utils/7702';

/**
 * Fully close a Morpho Blue position in one batch: repay ALL debt by borrow
 * shares (avoids debt growth between build and inclusion), then withdraw ALL
 * collateral to the executing ephemeral EOA (EIP-7702). Both the debt shares and
 * the collateral amount are read on-chain from the EOA's position.
 *
 * The unshielded loan token must cover the conservative repay bound
 * (`maxRepaidAssets`); any surplus reshields alongside the collateral.
 */
export class MorphoBlueClosePositionRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'Morpho Blue Close Position',
    description:
      'Repays all debt by shares and withdraws all collateral from a Morpho Blue market.',
    minGasLimit: MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW,
  };

  private readonly market: MarketParams;
  private readonly slippageBasisPoints: bigint;
  private readonly recipient: string;
  private readonly provider: Provider;

  constructor(
    market: MarketParams,
    slippageBasisPoints: bigint,
    recipient: EphemeralExecutor | string,
    provider: Provider,
  ) {
    super();
    this.market = market;
    this.slippageBasisPoints = slippageBasisPoints;
    this.recipient = resolveExecutorAddress(
      recipient,
      'MorphoBlueClosePositionRecipe recipient',
    );
    this.provider = provider;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return MorphoBlueAPI.supportsNetwork(networkName);
  }

  protected async getInternalSteps(
    firstInternalStepInput: StepInput,
  ): Promise<Step[]> {
    const repayQuote = await MorphoBlueAPI.getRepaySharesQuote({
      market: this.market,
      recipient: this.recipient,
      provider: this.provider,
      slippageBasisPoints: this.slippageBasisPoints,
    });
    const withdrawQuote = await MorphoBlueAPI.getWithdrawAllCollateralQuote({
      market: this.market,
      recipient: this.recipient,
      provider: this.provider,
    });

    const loanInput = firstInternalStepInput.erc20Amounts.find(
      erc20Amount =>
        erc20Amount.tokenAddress.toLowerCase() ===
        repayQuote.loanToken.toLowerCase(),
    );
    if (!loanInput || loanInput.expectedBalance < repayQuote.maxRepaidAssets) {
      throw new Error(
        `MorphoBlueClosePositionRecipe: unshielded loan ${
          loanInput?.expectedBalance ?? 0n
        } < required ${repayQuote.maxRepaidAssets}`,
      );
    }

    const loanInfo: RecipeERC20Info = {
      tokenAddress: repayQuote.loanToken,
      decimals: repayQuote.loanDecimals,
    };

    return [
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        loanInfo,
        repayQuote.maxRepaidAssets,
      ),
      new MorphoBlueRepaySharesStep(repayQuote),
      new MorphoBlueWithdrawCollateralStep(withdrawQuote),
    ];
  }
}
