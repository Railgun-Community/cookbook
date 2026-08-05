import { RecipeERC20Info } from '../../models/export-models';
import {
  FEE_DENOM,
  fxDebtBorrowOutput,
  resolvePool,
  type FxMintPoolRef,
} from '../../steps/borrow/fx/fx-mint-util';

/**
 * The pool's collateral, as a `RecipeERC20Info` for the 0x leg.
 *
 * Derived from the pool rather than accepted from the caller: this is what
 * makes "enter from any token" safe, and it replaces the old per-pool swap-quote
 * shape validation. A quote can no longer name a buy token that disagrees with
 * the collateral the position actually needs.
 */
export const fxCollateralERC20Info = (pool: FxMintPoolRef): RecipeERC20Info => {
  const resolved = resolvePool(pool);
  return {
    tokenAddress: resolved.collateralToken,
    decimals: resolved.collateralDecimals,
    isBaseToken: false,
  };
};

/**
 * The pool's DEBT token, as a `RecipeERC20Info` for the 0x leg — fxUSD on a
 * long, wstETH/WBTC on a short.
 *
 * The mirror of {@link fxCollateralERC20Info}, and load-bearing for the same
 * reason: a debt can only ever be repaid in the debt token, so an entry combo
 * that lets the caller name the buy side could quote a token `operate()` will
 * not accept. Derived from the pool, never passed in.
 */
export const fxDebtERC20Info = (pool: FxMintPoolRef): RecipeERC20Info => {
  const resolved = resolvePool(pool);
  return {
    tokenAddress: resolved.debtToken,
    decimals: resolved.debtDecimals,
    isBaseToken: false,
  };
};

/**
 * Reject a combo whose swap leg would be a no-op self-swap.
 *
 * 0x would either fail the quote or route through a pointless pair; either way
 * the caller wants the single-protocol recipe, not the combo.
 *
 * `role` names which side of the swap the caller supplied — 'sell' on the
 * deposit combos (entering from another token), 'buy' on the exit combo
 * (leaving into another token) — so the error points at the argument the caller
 * actually passed.
 */
export const assertSwapTokenIsNotCollateral = (
  callerERC20Info: RecipeERC20Info,
  poolERC20Info: RecipeERC20Info,
  role: 'sell' | 'buy',
  comboName: string,
  recipeName: string,
  /**
   * Which side of the pool `poolERC20Info` is. Only the error text changes —
   * but naming the wrong one sends the caller looking at the wrong argument,
   * and on a short pool the collateral and debt tokens are each other's
   * opposite, so "already the pool collateral" is actively misleading when the
   * clash was with the debt token.
   */
  poolTokenRole: 'collateral' | 'debt' = 'collateral',
): void => {
  if (
    callerERC20Info.tokenAddress.toLowerCase() ===
    poolERC20Info.tokenAddress.toLowerCase()
  ) {
    throw new Error(
      `${comboName}: ${role} token is already the pool ${poolTokenRole} (${poolERC20Info.tokenAddress}) — use ${recipeName} directly, no swap is needed`,
    );
  }
};

/**
 * How much debt token a borrow-exit combo's swap leg will actually be handed:
 * `additionalDebt` NET of f(x)'s borrow fee.
 *
 * The gross never reaches the executing account. Measured on mainnet
 * (`0x09a3bd9d…`, block 25078146, `wstETH-Long`): `operate(pool, 1912, 0, +1e18)`
 * minted 0.995 fxUSD to the caller and 0.005 to f(x)'s fee recipient — the
 * pool's 0.5% borrow fee, still live at block 25688619 as
 * `borrowFeeRatio = 5e6 / 1e9`. A swap sized at the gross therefore orders 0.5%
 * more than exists; 0x's `transferFrom` reverts, and under
 * `requireSuccess = false` the batch mines regardless — full gas, nothing
 * swapped. This is the exact mirror of `withdrawFeeRatio` on the close-then-swap
 * combo, and the reason neither combo lets the caller name the swap amount.
 *
 * `FxMintAdjustPositionStep` already declares this figure, so the seam carries
 * it without help; this is here so the combo can expose it to the caller (who
 * would otherwise re-derive the fee direction by hand) and so a fee ratio in the
 * wrong units is rejected at BUILD time rather than mining a no-op.
 *
 * Shorts charge nothing on the debt axis — `borrowFeeRatio = 0` on both, same
 * read — so there net == gross and this is the identity. Do not "simplify" on
 * the strength of a short-pool test.
 *
 * Callers must validate `additionalDebt > 0` first; both borrow recipes do it in
 * their constructors, so construct the fx recipe before calling this.
 */
export const fxBorrowSwapSeamAmount = (
  additionalDebt: bigint,
  borrowFeeRatio: bigint,
  comboName: string,
): bigint => {
  // The one misuse that is detectable without chain access. A ratio in basis
  // points (50 for 0.5%) sails through — it is inside the range and merely
  // 100,000x too small — which is why the recipes tell callers to read
  // `getFxPool(...).borrowFeeRatio` rather than write a literal.
  if (borrowFeeRatio < 0n || borrowFeeRatio >= FEE_DENOM) {
    throw new Error(
      `${comboName}: borrowFeeRatio ${borrowFeeRatio} is outside [0, ${FEE_DENOM}) — it is 1e9-denominated, from getFxPool(...).borrowFeeRatio`,
    );
  }
  return fxDebtBorrowOutput(additionalDebt, borrowFeeRatio);
};
