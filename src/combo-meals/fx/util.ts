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
