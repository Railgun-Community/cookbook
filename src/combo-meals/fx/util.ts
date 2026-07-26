import { RecipeERC20Info } from '../../models/export-models';
import {
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
export const fxCollateralERC20Info = (
  pool: FxMintPoolRef,
): RecipeERC20Info => {
  const resolved = resolvePool(pool);
  return {
    tokenAddress: resolved.collateralToken,
    decimals: resolved.collateralDecimals,
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
  collateralERC20Info: RecipeERC20Info,
  role: 'sell' | 'buy',
  comboName: string,
  recipeName: string,
): void => {
  if (
    callerERC20Info.tokenAddress.toLowerCase() ===
    collateralERC20Info.tokenAddress.toLowerCase()
  ) {
    throw new Error(
      `${comboName}: ${role} token is already the pool collateral (${collateralERC20Info.tokenAddress}) — use ${recipeName} directly, no swap is needed`,
    );
  }
};
