import { NetworkName } from '@railgun-community/shared-models';
import { Provider } from 'ethers';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../models/export-models';
import { ZeroXV2Quote } from '../../api/zero-x-v2/zero-x-v2-quote';
import { MorphoBlueAPI } from '../../api/morpho';
import {
  MarketParams,
  computeMorphoBlueRisk,
} from '../../steps/morpho/morpho-blue-util';
import {
  EphemeralExecutor,
  PositionOwner,
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
} from '../../utils/7702';
import type { ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMealOpts } from './zero-x-swap-morpho-blue-supply-collateral-and-borrow-combo-meal';
import { morphoBlueBorrowCeiling } from './util';

export type QuoteMorphoBlueSwapOpenParams = {
  networkName: NetworkName;
  market: MarketParams;
  /** The token the holder actually has, and how much of it to unshield. */
  sellERC20Amount: RecipeERC20Amount;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf`. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
  /**
   * Debt to draw, loan-token native units. Omit to size at
   * {@link targetLtvBasisPoints}.
   */
  borrowAssets?: bigint;
  /**
   * Target loan-to-value for the position AFTER this batch, in basis points of
   * the collateral's oracle value (5000 = 50 %). Used only when `borrowAssets`
   * is omitted, and required in that case: there is no defensible default here,
   * because the distance a holder wants from the LLTV is the whole risk
   * decision.
   */
  targetLtvBasisPoints?: bigint;
  isRailgun?: boolean;
};

export type QuoteMorphoBlueSwapOpenResult = {
  /** Ready to hand to `new ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal(...)`. */
  comboOpts: ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMealOpts;
  /** What the swap guarantees, and what the borrow was sized against. */
  guaranteedCollateral: bigint;
  /** What the swap expects. Anything above the guarantee reshields. */
  expectedCollateral: bigint;
  /** Collateral the owner already holds in this market. */
  existingCollateral: bigint;
  /** Debt already booked against the owner, interest-accrued. */
  existingBorrowAssets: bigint;
  /** The debt this batch will draw. */
  borrowAssets: bigint;
  /** The largest borrow the chain would accept at the guaranteed fill. */
  maxBorrowAssets: bigint;
  /** Which constraint produced `maxBorrowAssets`. */
  borrowBound: 'collateral' | 'liquidity';
  /**
   * Position health AFTER this batch, valued at the guaranteed fill. `>= 1e18`
   * healthy, `< 1e18` liquidatable. `undefined` only when `borrowAssets` is
   * zero, which this builder rejects — so in practice always present.
   */
  healthFactor?: bigint;
  /** Resulting LTV, 1e18-scaled. `undefined` when the collateral values to zero. */
  ltv?: bigint;
  /** Oracle price at which the resulting position becomes liquidatable. */
  liquidationPrice?: bigint;
  /** Same scale as `liquidationPrice`; the price the sizing was done at. */
  oraclePrice: bigint;
};

/**
 * Quote the swap and size the borrow against what that swap is GUARANTEED to
 * deliver as collateral, returning options ready for
 * `ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal`.
 *
 * Use this rather than sizing by hand. The combo's supply leg self-sizes from
 * the seam, so it always matches the fill; the borrow leg is a fixed number and
 * does not. A borrow sized against the EXPECTED fill is refused by Blue's health
 * check on any merely-average fill, and `requireSuccess = false` turns that
 * refusal into a batch that mines with the collateral supplied, no debt drawn,
 * and the executor↔position link now public.
 *
 * **The bound is de-rated by one unit and that is measured, not defensive** —
 * see `MORPHO_BLUE_BORROW_ROUNDING_UNIT`. Drawing exactly
 * `borrowCapacityRemaining` reverts `insufficient collateral` on a position with
 * no prior debt, which is precisely the position this combo opens.
 *
 * **What this deliberately does not do:** refuse a risky-but-valid borrow. The
 * ceiling is the largest number the chain accepts, not the largest number a
 * holder should draw; a position opened at the ceiling is one wei of price
 * movement from liquidation. `healthFactor`, `ltv` and `liquidationPrice` are
 * returned so the caller can see exactly where it sits, and
 * `targetLtvBasisPoints` is there for callers who would rather state the
 * distance than compute it.
 *
 * Quote and build together. The quote is a live market read and the combo
 * re-quotes when it builds; a stale guarantee is the one input that turns a
 * clean build into a batch that mines having done nothing.
 */
export async function quoteMorphoBlueSwapOpen(
  params: QuoteMorphoBlueSwapOpenParams,
): Promise<QuoteMorphoBlueSwapOpenResult> {
  const {
    networkName,
    market,
    sellERC20Amount,
    swapSlippageBasisPoints,
    executor: rawExecutor,
    owner: rawOwner,
    provider,
    borrowAssets: desiredBorrowAssets,
    targetLtvBasisPoints,
    isRailgun = false,
  } = params;

  const executor = resolveExecutorAddress(
    rawExecutor,
    'quoteMorphoBlueSwapOpen executor',
  );
  const owner =
    rawOwner === undefined
      ? executor
      : resolvePositionOwnerAddress(rawOwner, 'quoteMorphoBlueSwapOpen owner');

  if (
    sellERC20Amount.tokenAddress.toLowerCase() ===
    market.collateralToken.toLowerCase()
  ) {
    throw new Error(
      `quoteMorphoBlueSwapOpen: sell token is already the market collateral ` +
        `token (${market.collateralToken}) — use ` +
        'MorphoBlueSupplyCollateralAndBorrowRecipe directly, no swap is needed',
    );
  }
  if (desiredBorrowAssets === undefined && targetLtvBasisPoints === undefined) {
    throw new Error(
      'quoteMorphoBlueSwapOpen: pass borrowAssets, or targetLtvBasisPoints to ' +
        'size it. There is no default: how far the position sits from the LLTV ' +
        'is the risk decision this builder will not make for you.',
    );
  }
  if (
    targetLtvBasisPoints !== undefined &&
    (targetLtvBasisPoints < 1n || targetLtvBasisPoints > 10000n)
  ) {
    throw new Error(
      `quoteMorphoBlueSwapOpen: targetLtvBasisPoints must be 1..10000 (got ${targetLtvBasisPoints})`,
    );
  }

  // One market read shared with the position read. `getPositionRisks` is the
  // §9-safe shape: a position it could not read lands in `unreadable` rather
  // than being reported as an empty position, and an empty position is exactly
  // what would make an over-sized borrow look safe here.
  const report = await MorphoBlueAPI.getPositionRisks({
    market,
    owners: [owner],
    provider,
  });
  const [existing] = report.positions;
  if (existing === undefined) {
    const failure = report.unreadable[0];
    throw new Error(
      `quoteMorphoBlueSwapOpen: could not read ${owner}'s position in market ` +
        `${report.market.marketId} — ${failure?.reason ?? 'no reason given'}. ` +
        'Not treating an unreadable position as an empty one: an empty one ' +
        'would make any borrow look collateralised by this batch alone.',
    );
  }

  const buyERC20Info: RecipeERC20Info = {
    tokenAddress: report.market.collateralToken,
    decimals: report.market.collateralDecimals,
    isBaseToken: false,
  };
  const quote = await ZeroXV2Quote.getSwapQuote({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints: swapSlippageBasisPoints,
    isRailgun,
    recipient: executor,
  });

  const guaranteedCollateral = quote.minimumBuyAmount;
  const totalCollateral = existing.collateral + guaranteedCollateral;

  const ceiling = morphoBlueBorrowCeiling({
    collateral: totalCollateral,
    existingBorrowAssets: existing.borrowAssets,
    oraclePrice: report.market.oraclePrice,
    lltv: report.market.lltv,
    liquidityAssets: report.market.liquidityAssets,
  });

  const borrowAssets =
    desiredBorrowAssets ??
    targetLtvBorrow({
      collateral: totalCollateral,
      oraclePrice: report.market.oraclePrice,
      targetLtvBasisPoints: targetLtvBasisPoints as bigint,
      existingBorrowAssets: existing.borrowAssets,
    });

  if (borrowAssets <= 0n) {
    throw new Error(
      `quoteMorphoBlueSwapOpen: the borrow sizes to ${borrowAssets} — the ` +
        `owner's existing debt (${existing.borrowAssets}) already meets or ` +
        'exceeds the target. Supply collateral without borrowing instead of ' +
        'building a batch whose borrow leg cannot succeed.',
    );
  }
  if (borrowAssets > ceiling.ceiling) {
    throw new Error(
      `quoteMorphoBlueSwapOpen: borrowing ${borrowAssets} exceeds the ` +
        `${ceiling.bound} bound of ${ceiling.ceiling} at the swap's GUARANTEED ` +
        `fill (${guaranteedCollateral} ${report.market.collateralToken}; the ` +
        `quote expects ${quote.buyERC20Amount.amount}). Sizing against the ` +
        'expected fill instead would build a batch that supplies the collateral, ' +
        'is refused by Blue, and still mines — leaving the position open and ' +
        'public with no debt drawn.',
    );
  }

  const resulting = computeMorphoBlueRisk({
    collateral: totalCollateral,
    borrowAssets: existing.borrowAssets + borrowAssets,
    oraclePrice: report.market.oraclePrice,
    lltv: report.market.lltv,
  });

  return {
    comboOpts: {
      market,
      sellERC20Info: {
        tokenAddress: sellERC20Amount.tokenAddress,
        decimals: sellERC20Amount.decimals,
        isBaseToken: false,
      },
      swapSlippageBasisPoints,
      borrowAssets,
      executor,
      owner,
      provider,
    },
    guaranteedCollateral,
    expectedCollateral: quote.buyERC20Amount.amount,
    existingCollateral: existing.collateral,
    existingBorrowAssets: existing.borrowAssets,
    borrowAssets,
    maxBorrowAssets: ceiling.ceiling,
    borrowBound: ceiling.bound,
    healthFactor: resulting.healthFactor,
    ltv: resulting.ltv,
    liquidationPrice: resulting.liquidationPrice,
    oraclePrice: report.market.oraclePrice,
  };
}

/**
 * Debt that lands the position at `targetLtvBasisPoints` of its collateral
 * value, net of what the owner already owes.
 *
 * Floored, never rounded up: rounding up a target LTV walks toward the LLTV,
 * and the one unit gained is not worth a build that lands a basis point closer
 * to the cliff than the caller asked for.
 */
const targetLtvBorrow = (params: {
  collateral: bigint;
  oraclePrice: bigint;
  targetLtvBasisPoints: bigint;
  existingBorrowAssets: bigint;
}): bigint => {
  const { collateral, oraclePrice, targetLtvBasisPoints, existingBorrowAssets } =
    params;
  // Same flooring as Morpho's own `collateral.mulDivDown(price, SCALE)`, so the
  // value this targets is the value the health check will use.
  const collateralValue = (collateral * oraclePrice) / 10n ** 36n;
  const targetDebt = (collateralValue * targetLtvBasisPoints) / 10000n;
  return targetDebt > existingBorrowAssets
    ? targetDebt - existingBorrowAssets
    : 0n;
};
