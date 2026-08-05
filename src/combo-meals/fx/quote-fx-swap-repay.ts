import { NetworkName } from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../models/export-models';
import { ZeroXV2Quote } from '../../api/zero-x-v2/zero-x-v2-quote';
import {
  computeFxRepay,
  resolvePool,
  type FxMintPoolRef,
} from '../../steps/borrow/fx/fx-mint-util';
import { fxDebtERC20Info } from './util';
import type { ZeroXSwap_FxMintRepay_ComboMealOpts } from './zero-x-swap-fx-mint-repay-combo-meal';
import {
  resolveExecutorAddress,
  type EphemeralExecutor,
} from '../../utils/7702';

export type QuoteFxSwapRepayParams = {
  networkName: NetworkName;
  pool: FxMintPoolRef;
  positionId: bigint;
  /** The token the holder actually has, and how much of it to unshield. */
  sellERC20Amount: RecipeERC20Amount;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch will execute as. */
  recipient: EphemeralExecutor | string;
  /** Position debt, native units — `getFxPosition().debt`, NOT `rawDebts`. */
  debt: bigint;
  /** `getFxPool(...).repayFeeRatio`, 1e9-denominated. */
  repayFeeRatio: bigint;
  /**
   * Cap on the debt reduction, native units. Omit to repay as much as the
   * guaranteed fill allows, up to the whole debt.
   */
  desiredRepayAmount?: bigint;
  isRailgun?: boolean;
};

export type QuoteFxSwapRepayResult = {
  /** Ready to hand to `new ZeroXSwap_FxMintRepay_ComboMeal(...)`. */
  comboOpts: ZeroXSwap_FxMintRepay_ComboMealOpts;
  /** What the swap guarantees, and what the repay was sized against. */
  guaranteedDebtToken: bigint;
  /** What the swap expects. Anything above the guarantee reshields. */
  expectedDebtToken: bigint;
  /** Debt remaining after this repay, at the guaranteed fill. */
  remainingDebt: bigint;
  /** True when the guaranteed fill retires the position's whole debt. */
  clearsDebt: boolean;
};

/**
 * Quote the swap and size the repay against what that swap is GUARANTEED to
 * deliver, returning options ready for `ZeroXSwap_FxMintRepay_ComboMeal`.
 *
 * The debt-side sibling of `quoteFxSwapClose`, and it carries the same
 * `railgunUnshieldFeeBps: 0n` reasoning: `computeFxRepay` subtracts an unshield
 * fee because in the single-recipe flow the debt token arrives by unshielding
 * it, but here the fee was already charged on the SELL token upstream and the
 * debt token is produced mid-batch by the swap. Charging it twice under-repays.
 *
 * **A full repay does NOT close the position.** `operate(positionId, 0, -debt)`
 * clears the debt and leaves the collateral where it is, so the holder keeps an
 * unlevered position rather than exiting. Use `quoteFxSwapClose` when the intent
 * is to get the collateral back.
 */
export async function quoteFxSwapRepay(
  params: QuoteFxSwapRepayParams,
): Promise<QuoteFxSwapRepayResult> {
  const {
    networkName,
    pool,
    positionId,
    sellERC20Amount,
    swapSlippageBasisPoints,
    recipient,
    debt,
    repayFeeRatio,
    desiredRepayAmount,
    isRailgun = false,
  } = params;

  const executor = resolveExecutorAddress(
    recipient,
    'quoteFxSwapRepay recipient',
  );
  const buyERC20Info: RecipeERC20Info = fxDebtERC20Info(pool);

  if (
    sellERC20Amount.tokenAddress.toLowerCase() ===
    buyERC20Info.tokenAddress.toLowerCase()
  ) {
    throw new Error(
      `quoteFxSwapRepay: sell token is already the pool debt token ` +
        `(${buyERC20Info.tokenAddress}) — size with computeFxRepay and use ` +
        'FxMintRepayDebtRecipe directly, no swap is needed',
    );
  }

  const quote = await ZeroXV2Quote.getSwapQuote({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints: swapSlippageBasisPoints,
    isRailgun,
    recipient: executor,
  });

  const guaranteedDebtToken = quote.minimumBuyAmount;

  const amounts = computeFxRepay({
    debt,
    availableDebtToken: guaranteedDebtToken,
    // Default to "as much as the fill allows"; computeFxRepay caps against both
    // the debt and the post-fee ceiling, so passing the debt is not a request to
    // overshoot.
    desiredRepayAmount: desiredRepayAmount ?? debt,
    repayFeeRatio,
    // See the docblock: the unshield fee was charged on the sell token, and this
    // debt token never passes through an unshield.
    railgunUnshieldFeeBps: 0n,
  });

  if (amounts.repayAmount === 0n) {
    const resolved = resolvePool(pool);
    throw new Error(
      `quoteFxSwapRepay: the guaranteed swap output (${guaranteedDebtToken} ` +
        `${resolved.debtToken}) does not cover any repayment once f(x)'s repay ` +
        `fee is applied. Sell more, or widen slippage — sizing against the ` +
        `expected fill (${quote.buyERC20Amount.amount}) instead would build a ` +
        'batch that mines having repaid nothing.',
    );
  }

  return {
    comboOpts: {
      pool,
      positionId,
      repayAmount: amounts.repayAmount,
      approveAmount: amounts.approveAmount,
      repayFeeRatio,
      sellERC20Info: {
        tokenAddress: sellERC20Amount.tokenAddress,
        decimals: sellERC20Amount.decimals,
        isBaseToken: false,
      },
      swapSlippageBasisPoints,
      recipient: executor,
    },
    guaranteedDebtToken,
    expectedDebtToken: quote.buyERC20Amount.amount,
    remainingDebt: debt - amounts.repayAmount,
    clearsDebt: amounts.repayAmount === debt,
  };
}
