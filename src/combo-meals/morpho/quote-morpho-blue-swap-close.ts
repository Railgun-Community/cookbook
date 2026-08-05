import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../models/export-models';
import { ZeroXV2Quote } from '../../api/zero-x-v2/zero-x-v2-quote';
import { MorphoBlueAPI } from '../../api/morpho';
import { MarketParams } from '../../steps/morpho/morpho-blue-util';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
} from '../../utils/7702';
import type { ZeroXSwap_MorphoBlueClosePosition_ComboMealOpts } from './zero-x-swap-morpho-blue-close-position-combo-meal';
import { morphoBlueLoanERC20Info } from './util';

export type QuoteMorphoBlueSwapCloseParams = {
  networkName: NetworkName;
  market: MarketParams;
  /** The token the holder actually has, and how much of it to unshield. */
  sellERC20Amount: RecipeERC20Amount;
  swapSlippageBasisPoints: number;
  /**
   * Buffer on the shares→assets conversion, 1..10000 bps. Non-zero is required
   * by `getRepaySharesQuote`: it absorbs the interest that accrues between build
   * and inclusion.
   */
  repaySlippageBasisPoints: bigint;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — whose position is closed. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
  isRailgun?: boolean;
};

export type QuoteMorphoBlueSwapCloseResult = {
  /** Ready to hand to `new ZeroXSwap_MorphoBlueClosePosition_ComboMeal(...)`. */
  comboOpts: ZeroXSwap_MorphoBlueClosePosition_ComboMealOpts;
  /** What the swap guarantees, and what the close is checked against. */
  guaranteedLoanToken: bigint;
  /** What the swap expects. Anything above the budget reshields. */
  expectedLoanToken: bigint;
  /** Borrow shares the close will burn — the exact, drift-free magnitude. */
  repayShares: bigint;
  /** What those shares are worth now. */
  expectedRepaidAssets: bigint;
  /** The conservative budget the repay leg spends. The number that must be covered. */
  maxRepaidAssets: bigint;
  /** Collateral the close releases, all of it. */
  withdrawCollateral: bigint;
  /** Surplus loan token at the guaranteed fill: what reshields. */
  surplusLoanToken: bigint;
};

/**
 * Quote the swap and check it against the close's conservative repay budget,
 * returning options ready for `ZeroXSwap_MorphoBlueClosePosition_ComboMeal`.
 *
 * The combo's own guard (`MorphoBlueClosePositionRecipe` refusing to build when
 * its loan input is below `maxRepaidAssets`) is the backstop and stays the
 * authority. This runs the comparison earlier and for a different audience: it
 * reports how much loan token the close needs BEFORE a sell amount is chosen, so
 * the caller can size the sell side rather than binary-search it against a
 * recipe error that speaks of an "unshielded loan" this combo never unshields.
 *
 * **`maxRepaidAssets`, not the debt, is the figure to cover.** A shares-mode
 * repay pulls whatever the shares are worth at inclusion, which is strictly more
 * than they are worth now; `repaySlippageBasisPoints` is the headroom, and the
 * unused part reshields. Sizing the swap at the current debt therefore under-
 * funds the close by exactly the buffer.
 *
 * **`withdrawCollateral` is read at quote time and is not guaranteed.** Nothing
 * this batch does can change it, but a liquidation in the interim can. The
 * close reads it again when it builds; a shrink between the two makes the
 * withdraw leg's declared output larger than the position holds, which reverts
 * and is swallowed. Treat a stale quote as unsafe here, not merely stale.
 */
export async function quoteMorphoBlueSwapClose(
  params: QuoteMorphoBlueSwapCloseParams,
): Promise<QuoteMorphoBlueSwapCloseResult> {
  const {
    networkName,
    market,
    sellERC20Amount,
    swapSlippageBasisPoints,
    repaySlippageBasisPoints,
    executor: rawExecutor,
    owner: rawOwner,
    provider,
    isRailgun = false,
  } = params;

  const executor = resolveExecutorAddress(
    rawExecutor,
    'quoteMorphoBlueSwapClose executor',
  );
  const owner =
    rawOwner === undefined
      ? executor
      : resolvePositionOwnerAddress(rawOwner, 'quoteMorphoBlueSwapClose owner');

  if (
    sellERC20Amount.tokenAddress.toLowerCase() ===
    market.loanToken.toLowerCase()
  ) {
    throw new Error(
      `quoteMorphoBlueSwapClose: sell token is already the market loan token ` +
        `(${market.loanToken}) — use MorphoBlueClosePositionRecipe directly, ` +
        'no swap is needed',
    );
  }

  // Both reads the close itself makes, made here in the same order. Each throws
  // on its own terms rather than reporting a zero: an empty position is a
  // refusal ('no borrow shares to repay' / 'no collateral to withdraw'), never
  // a close of nothing.
  const repayQuote = await MorphoBlueAPI.getRepaySharesQuote({
    market,
    owner,
    provider,
    slippageBasisPoints: repaySlippageBasisPoints,
  });
  const withdrawQuote = await MorphoBlueAPI.getWithdrawAllCollateralQuote({
    market,
    owner,
    receiver: executor,
    provider,
  });

  const buyERC20Info: RecipeERC20Info = await morphoBlueLoanERC20Info(
    market,
    provider,
  );
  const quote = await ZeroXV2Quote.getSwapQuote({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints: swapSlippageBasisPoints,
    isRailgun,
    recipient: executor,
  });

  const guaranteedLoanToken = quote.minimumBuyAmount;
  if (guaranteedLoanToken < repayQuote.maxRepaidAssets) {
    throw new Error(
      `quoteMorphoBlueSwapClose: the guaranteed swap output ` +
        `(${guaranteedLoanToken} ${market.loanToken}) is below the close's ` +
        `repay budget of ${repayQuote.maxRepaidAssets} (${repayQuote.repayShares} ` +
        `shares, worth ${repayQuote.expectedRepaidAssets} now, plus ` +
        `${repaySlippageBasisPoints} bps for accrual). Sell more, or widen ` +
        `slippage — the expected fill (${quote.buyERC20Amount.amount}) is not a ` +
        'promise, and a close that reaches chain under-funded leaves the debt ' +
        'partly repaid with the collateral still inside Blue.',
    );
  }

  return {
    comboOpts: {
      market,
      sellERC20Info: {
        tokenAddress: sellERC20Amount.tokenAddress,
        decimals: sellERC20Amount.decimals,
        isBaseToken: false,
      },
      swapSlippageBasisPoints,
      repaySlippageBasisPoints,
      executor,
      owner,
      provider,
    },
    guaranteedLoanToken,
    expectedLoanToken: quote.buyERC20Amount.amount,
    repayShares: repayQuote.repayShares,
    expectedRepaidAssets: repayQuote.expectedRepaidAssets,
    maxRepaidAssets: repayQuote.maxRepaidAssets,
    withdrawCollateral: withdrawQuote.withdrawAssets,
    surplusLoanToken: guaranteedLoanToken - repayQuote.maxRepaidAssets,
  };
}
