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
import type { ZeroXSwap_MorphoBlueRepay_ComboMealOpts } from './zero-x-swap-morpho-blue-repay-combo-meal';
import { morphoBlueLoanERC20Info } from './util';

export type QuoteMorphoBlueSwapRepayParams = {
  networkName: NetworkName;
  market: MarketParams;
  /** The token the holder actually has, and how much of it to unshield. */
  sellERC20Amount: RecipeERC20Amount;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — whose debt falls. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
  /**
   * Refuse to build unless the GUARANTEED fill retires the whole debt.
   *
   * Off by default, because a short repay is a real and useful outcome — the
   * position survives and the repay can be repeated. Turn it on when the caller
   * treats a partial repay as a failed operation, so the refusal happens at
   * build time instead of being invisible in a batch that mines.
   */
  requireFullRepay?: boolean;
  isRailgun?: boolean;
};

export type QuoteMorphoBlueSwapRepayResult = {
  /** Ready to hand to `new ZeroXSwap_MorphoBlueRepay_ComboMeal(...)`. */
  comboOpts: ZeroXSwap_MorphoBlueRepay_ComboMealOpts;
  /** What the swap guarantees, and what the repay will be sized against. */
  guaranteedLoanToken: bigint;
  /** What the swap expects. Anything above the guarantee reshields. */
  expectedLoanToken: bigint;
  /**
   * The owner's debt at quote time — `borrowAssetsForShares` over the market's
   * STORED totals, which is exactly what `getRepayQuote` caps the build against.
   * It is a floor on the debt at inclusion, never a ceiling: interest accrues
   * from `market().lastUpdate` onward and this figure does not include it.
   */
  debt: bigint;
  /** Debt reduction at the guaranteed fill: `min(guaranteed, debt)`. */
  repayAssets: bigint;
  /** Debt remaining after this repay, at the guaranteed fill. */
  remainingDebt: bigint;
  /** True when the guaranteed fill retires the whole debt. */
  clearsDebt: boolean;
};

/**
 * Quote the swap, read the debt, and report what the repay will actually
 * achieve — returning options ready for `ZeroXSwap_MorphoBlueRepay_ComboMeal`.
 *
 * Unlike `quoteFxSwapRepay`, this computes **no amount the combo needs**. The
 * combo cannot be mis-sized: the repay recipe reads its amount out of the seam
 * and `getRepayQuote` caps it at the debt, so with the conservative seam the
 * encoded repay is `min(minimumBuyAmount, debt)` whatever the caller does. What
 * this adds is the number the built batch does not show — whether that is the
 * whole debt or only part of it.
 *
 * That distinction matters because the two outcomes are indistinguishable on
 * chain: both mine with status 1, and a short repay looks exactly like a
 * successful one unless you read the position back. `clearsDebt` is the answer
 * before the batch is sent; `requireFullRepay` turns it into a refusal.
 *
 * **`debt` is a floor, so `clearsDebt` means "clears the debt as read", not
 * "leaves nothing".** It comes from the market's stored totals, un-accrued —
 * the same basis `getRepayQuote` caps against, so it matches what the build
 * encodes, but interest keeps accruing until inclusion and an assets-denominated
 * repay therefore always lands a few units short of zero. Use
 * `quoteMorphoBlueSwapClose`, which repays by SHARES, when the intent is to
 * genuinely retire the debt rather than shrink it.
 */
export async function quoteMorphoBlueSwapRepay(
  params: QuoteMorphoBlueSwapRepayParams,
): Promise<QuoteMorphoBlueSwapRepayResult> {
  const {
    networkName,
    market,
    sellERC20Amount,
    swapSlippageBasisPoints,
    executor: rawExecutor,
    owner: rawOwner,
    provider,
    requireFullRepay = false,
    isRailgun = false,
  } = params;

  const executor = resolveExecutorAddress(
    rawExecutor,
    'quoteMorphoBlueSwapRepay executor',
  );
  const owner =
    rawOwner === undefined
      ? executor
      : resolvePositionOwnerAddress(rawOwner, 'quoteMorphoBlueSwapRepay owner');

  if (
    sellERC20Amount.tokenAddress.toLowerCase() ===
    market.loanToken.toLowerCase()
  ) {
    throw new Error(
      `quoteMorphoBlueSwapRepay: sell token is already the market loan token ` +
        `(${market.loanToken}) — use MorphoBlueRepayRecipe directly, no swap ` +
        'is needed',
    );
  }

  // Deliberately NOT `getPositionRisks`, which is the obvious reader here.
  // That one reads the oracle and refuses a market whose price feed is dead or
  // absent — correct for sizing a borrow, wrong for sizing a repay. A repay
  // needs no price, and a market whose oracle has stopped answering is exactly
  // the market a borrower most wants out of; refusing to quote there would
  // withhold the operation at the moment it matters.
  //
  // `expectedRepaidAssets` on a full-shares quote is bit-identical to the
  // `owedAssets` figure `getRepayQuote` caps against — same `borrowAssetsForShares`
  // over the same un-accrued `market()` read — so this reports the debt the
  // build will actually see. The slippage argument is a placeholder: only the
  // expected figure is read, and the builder requires the value to be in range.
  const debtQuote = await MorphoBlueAPI.getRepaySharesQuote({
    market,
    owner,
    provider,
    slippageBasisPoints: 1n,
  });
  const debt = debtQuote.expectedRepaidAssets;

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
  // Mirrors `getRepayQuote`'s cap exactly: the recipe will re-derive this from
  // the seam, so a different rule here would report a repay the build does not
  // encode.
  const repayAssets =
    guaranteedLoanToken < debt ? guaranteedLoanToken : debt;
  const clearsDebt = repayAssets >= debt;

  if (requireFullRepay && !clearsDebt) {
    throw new Error(
      `quoteMorphoBlueSwapRepay: the guaranteed swap output ` +
        `(${guaranteedLoanToken} ${market.loanToken}) covers only ` +
        `${repayAssets} of ${debt} debt. Sell more, or widen ` +
        `slippage — the expected fill (${quote.buyERC20Amount.amount}) is not a ` +
        'promise, and a batch sized against it mines as a partial repay that ' +
        'looks identical to a full one.',
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
      executor,
      owner,
      provider,
    },
    guaranteedLoanToken,
    expectedLoanToken: quote.buyERC20Amount.amount,
    debt,
    repayAssets,
    remainingDebt: debt - repayAssets,
    clearsDebt,
  };
}
