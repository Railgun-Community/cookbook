import { Provider } from 'ethers';
import type { RecipeERC20Info } from '../../models/export-models';
import { MorphoBlueAPI } from '../../api/morpho';
import { getMarketId, type MarketParams } from '../../steps/morpho/morpho-blue-util';
import {
  resolveExecutorAddress,
  resolvePositionOwnerAddress,
  type EphemeralExecutor,
  type PositionOwner,
} from '../../utils/7702';
import type { MorphoBlueBorrow_ZeroXSwap_ComboMealOpts } from './morpho-blue-borrow-zero-x-swap-combo-meal';
import { morphoBlueBorrowCeiling } from './util';

export type QuoteMorphoBlueSwapBorrowParams = {
  market: MarketParams;
  /** Any ERC-20 to receive. The borrowed loan token is swapped into this. */
  buyERC20Info: RecipeERC20Info;
  swapSlippageBasisPoints: number;
  /** The EIP-7702 ephemeral EOA the batch executes as, and shields from. */
  executor: EphemeralExecutor | string;
  /** Blue `onBehalf` — the account the debt is booked against. Defaults to the executor. */
  owner?: PositionOwner;
  provider: Provider;
  /** Debt to draw, loan-token native units. Omit to draw the full ceiling. */
  borrowAssets?: bigint;
};

export type QuoteMorphoBlueSwapBorrowResult = {
  /** Ready to hand to `new MorphoBlueBorrow_ZeroXSwap_ComboMeal(...)`. */
  comboOpts: MorphoBlueBorrow_ZeroXSwap_ComboMealOpts;
  /** The debt this batch will draw. */
  borrowAssets: bigint;
  /** The largest borrow the chain would accept right now. */
  maxBorrowAssets: bigint;
  /** Which constraint produced `maxBorrowAssets`. */
  borrowBound: 'collateral' | 'liquidity';
  /** Collateral the owner already holds in this market. */
  existingCollateral: bigint;
  /** Debt already booked against the owner, interest-accrued. */
  existingBorrowAssets: bigint;
};

/**
 * Size a borrow against what the position and the market will actually bear,
 * and return options ready for `MorphoBlueBorrow_ZeroXSwap_ComboMeal`.
 *
 * **Why this has to exist rather than being a docblock warning.**
 * `MorphoBlueAPI.getBorrowQuote` preflights AUTHORIZATION and nothing else — not
 * the LLTV, not the market's free liquidity. Both revert inside Blue and both
 * are swallowed by `requireSuccess = false`: the batch mines with no debt drawn,
 * the 0x leg then tries to sell loan tokens the executor never received and
 * reverts too, and the holder pays both RAILGUN fees and the gas for a batch
 * that did nothing. The three sibling combos all got a builder that prevents
 * this; this one shipped with a comment describing the hazard instead, which
 * does not stop anyone building the batch.
 *
 * Carries the same measured one-unit de-rate as `quoteMorphoBlueSwapOpen`:
 * Blue's `toSharesUp` then `toAssetsUp` gives `borrowed = assets + 1` whenever
 * the share conversion rounds up, so borrowing the exact computed capacity
 * reverts `insufficient collateral`. Verified on two live markets —
 * `borrow(max)` reverts, `borrow(max - 1)` succeeds. The liquidity bound needs
 * no de-rate and gets none: `borrow(free)` succeeds and `borrow(free + 1)`
 * reverts, so the bound is exact.
 *
 * Read and build together. Both bounds move with other people's activity —
 * liquidity with every borrow and repay, capacity with the oracle.
 */
export async function quoteMorphoBlueSwapBorrow(
  params: QuoteMorphoBlueSwapBorrowParams,
): Promise<QuoteMorphoBlueSwapBorrowResult> {
  const {
    market,
    buyERC20Info,
    swapSlippageBasisPoints,
    executor,
    owner,
    provider,
    borrowAssets,
  } = params;

  const executorAddress = resolveExecutorAddress(
    executor,
    'quoteMorphoBlueSwapBorrow executor',
  );
  const ownerAddress = resolvePositionOwnerAddress(
    owner ?? executorAddress,
    'quoteMorphoBlueSwapBorrow owner',
  );

  const marketId = getMarketId(market);
  const report = await MorphoBlueAPI.getPositionRisks({
    market,
    owners: [ownerAddress],
    provider,
  });

  // Never map a read failure onto "you can borrow nothing", and never onto "you
  // can borrow anything" either. Both are wrong in ways that only show up on
  // chain, where the revert is swallowed.
  if (report.unreadableCount > 0 || report.positions.length === 0) {
    const reason =
      report.unreadable[0]?.reason ?? 'the position could not be read';
    throw new Error(
      `quoteMorphoBlueSwapBorrow: cannot size a borrow for ${ownerAddress} in ` +
        `market ${marketId} — ${reason}. Refusing rather than guessing: an ` +
        'unaffordable borrow mines successfully and charges full fees.',
    );
  }

  const position = report.positions[0];
  // `totals` is the interest-ACCRUED view; `storedTotals` is what the chain
  // last wrote. Free liquidity is invariant under accrual — Blue adds the same
  // interest to both sides — but using the accrued view keeps this consistent
  // with the capacity figures, which are not invariant.
  const { totalSupplyAssets, totalBorrowAssets } = report.market.totals;
  const liquidityAssets =
    totalSupplyAssets > totalBorrowAssets
      ? totalSupplyAssets - totalBorrowAssets
      : 0n;

  const ceiling = morphoBlueBorrowCeiling({
    collateral: position.collateral,
    existingBorrowAssets: position.borrowAssets,
    oraclePrice: position.oraclePrice,
    lltv: market.lltv,
    liquidityAssets,
  });

  if (ceiling.ceiling <= 0n) {
    throw new Error(
      `quoteMorphoBlueSwapBorrow: nothing can be borrowed against ${ownerAddress} ` +
        `in market ${marketId} right now — collateral allows ` +
        `${ceiling.collateralLimited}, free liquidity allows ` +
        `${ceiling.liquidityLimited}. Supply more collateral, repay, or wait ` +
        'for borrowers to repay.',
    );
  }

  const requested = borrowAssets ?? ceiling.ceiling;
  if (requested <= 0n) {
    throw new Error(
      `quoteMorphoBlueSwapBorrow: borrowAssets must be > 0 (got ${requested})`,
    );
  }
  if (requested > ceiling.ceiling) {
    throw new Error(
      `quoteMorphoBlueSwapBorrow: a borrow of ${requested} exceeds what this ` +
        `position and market bear (${ceiling.ceiling}, bound by ` +
        `${ceiling.bound}). Blue would revert, and under requireSuccess = false ` +
        'that revert is swallowed — the batch mines having drawn no debt, the ' +
        'swap leg then sells tokens that never arrived, and both RAILGUN fees ' +
        'are charged for nothing.',
    );
  }

  return {
    comboOpts: {
      market,
      borrowAssets: requested,
      buyERC20Info,
      swapSlippageBasisPoints,
      executor: executorAddress,
      owner: ownerAddress,
      provider,
    },
    borrowAssets: requested,
    maxBorrowAssets: ceiling.ceiling,
    borrowBound: ceiling.bound,
    existingCollateral: position.collateral,
    existingBorrowAssets: position.borrowAssets,
  };
}
