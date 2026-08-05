import { NetworkName } from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../models/export-models';
import { ZeroXV2Quote } from '../../api/zero-x-v2/zero-x-v2-quote';
import {
  computeFxClose,
  resolvePool,
  type FxMintPoolRef,
} from '../../steps/borrow/fx/fx-mint-util';
import { fxDebtERC20Info } from './util';
import type { ZeroXSwap_FxMintClose_ComboMealOpts } from './zero-x-swap-fx-mint-close-combo-meal';
import {
  resolveExecutorAddress,
  type EphemeralExecutor,
} from '../../utils/7702';

export type QuoteFxSwapCloseParams = {
  networkName: NetworkName;
  pool: FxMintPoolRef;
  positionId: bigint;
  /** The token the holder actually has, and how much of it to unshield. */
  sellERC20Amount: RecipeERC20Amount;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch will execute as. */
  recipient: EphemeralExecutor | string;
  /** Position collateral, native units — `getFxPosition().collateralAmount`. */
  collateral: bigint;
  /** Position debt, native units — `getFxPosition().debt`, NOT `rawDebts`. */
  debt: bigint;
  /** `getFxPool(...).repayFeeRatio`, 1e9-denominated. */
  repayFeeRatio: bigint;
  /** `getFxPool(...).withdrawFeeRatio`, 1e9-denominated. `0n` on the longs. */
  withdrawFeeRatio: bigint;
  isRailgun?: boolean;
};

export type QuoteFxSwapCloseResult = {
  /** Ready to hand to `new ZeroXSwap_FxMintClose_ComboMeal(...)`. */
  comboOpts: ZeroXSwap_FxMintClose_ComboMealOpts;
  /** What the swap guarantees, and what the close was sized against. */
  guaranteedDebtToken: bigint;
  /** What the swap expects. Anything above the guarantee reshields. */
  expectedDebtToken: bigint;
  /** True when the guaranteed fill retires the position's whole debt. */
  closesFully: boolean;
  /** Collateral the holder receives, net of f(x)'s withdraw fee. */
  withdrawCollNet: bigint;
};

/**
 * Quote the swap and size the close against what that swap is GUARANTEED to
 * deliver, returning options ready for {@link ZeroXSwap_FxMintClose_ComboMeal}.
 *
 * Use this rather than sizing by hand. `operate()` is built with an exact
 * `repayAmount` and pulls `repayAmount x (1 + repayFeeRatio)`, while 0x V2
 * quotes are sell-amount only — no quote can promise an exact output. Sizing
 * against the expected fill therefore leaves the close short whenever the fill
 * is merely average, which is most of the time.
 *
 * **`railgunUnshieldFeeBps` is deliberately `0n` here, and that is not an
 * oversight.** `computeFxClose` subtracts an unshield fee because in the
 * single-recipe flow the debt token arrives by unshielding it. In this combo it
 * does not: the fee was already taken from the SELL token upstream, and the debt
 * token is produced mid-batch by the swap. Charging it again would size the
 * close below what the executor actually holds — safe, but it silently leaves
 * debt outstanding on what the caller asked to be a full close.
 *
 * Quote and build together. The quote is a live market read, and the combo
 * re-quotes when it builds; a stale guarantee is the one input that turns a
 * clean build into a batch that mines having done nothing.
 */
export async function quoteFxSwapClose(
  params: QuoteFxSwapCloseParams,
): Promise<QuoteFxSwapCloseResult> {
  const {
    networkName,
    pool,
    positionId,
    sellERC20Amount,
    swapSlippageBasisPoints,
    recipient,
    collateral,
    debt,
    repayFeeRatio,
    withdrawFeeRatio,
    isRailgun = false,
  } = params;

  const executor = resolveExecutorAddress(recipient, 'quoteFxSwapClose recipient');
  const buyERC20Info: RecipeERC20Info = fxDebtERC20Info(pool);

  if (
    sellERC20Amount.tokenAddress.toLowerCase() ===
    buyERC20Info.tokenAddress.toLowerCase()
  ) {
    throw new Error(
      `quoteFxSwapClose: sell token is already the pool debt token ` +
        `(${buyERC20Info.tokenAddress}) — size the close with computeFxClose ` +
        'and use FxMintCloseRecipe directly, no swap is needed',
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

  const amounts = computeFxClose({
    collateral,
    debt,
    availableDebtToken: guaranteedDebtToken,
    repayFeeRatio,
    withdrawFeeRatio,
    // See the docblock: the unshield fee was charged on the sell token, and
    // this debt token never passes through an unshield at all.
    railgunUnshieldFeeBps: 0n,
  });

  if (amounts.repayAmount === 0n) {
    const resolved = resolvePool(pool);
    throw new Error(
      `quoteFxSwapClose: the guaranteed swap output (${guaranteedDebtToken} ` +
        `${resolved.debtToken}) does not cover any repayment once f(x)'s repay ` +
        `fee is applied. Sell more, or widen slippage — sizing against the ` +
        `expected fill (${quote.buyERC20Amount.amount}) instead would build a ` +
        'batch that mines having done nothing.',
    );
  }

  return {
    comboOpts: {
      pool,
      positionId,
      repayAmount: amounts.repayAmount,
      withdrawColl: amounts.withdrawColl,
      approveAmount: amounts.approveAmount,
      withdrawFeeRatio: amounts.withdrawFeeRatio,
      partialClose: amounts.partialClose,
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
    closesFully: !amounts.partialClose,
    withdrawCollNet: amounts.withdrawCollNet,
  };
}
