import { Provider } from 'ethers';
import { RecipeERC20Info } from '../../models/export-models';
import { ERC20Contract } from '../../contract/token/erc20-contract';
import {
  MarketParams,
  computeMorphoBlueRisk,
} from '../../steps/morpho/morpho-blue-util';

/**
 * The market's LOAN token, as a `RecipeERC20Info` for the 0x leg.
 *
 * Derived from the market rather than accepted from the caller, for the same
 * reason `fxDebtERC20Info` is derived from the pool: a debt is repayable only in
 * the loan token, a lend position is denominated only in the loan token, and a
 * borrow pays out only the loan token. A combo that let the caller name the
 * swap's loan side could quote a token Blue will not accept, and the resulting
 * revert is swallowed by `requireSuccess = false`.
 *
 * `decimals` is read on chain because a Blue market descriptor carries only
 * addresses — unlike f(x), whose pool descriptors are static and ship with the
 * cookbook. Permissionless market creation is why: there is no curated table to
 * read the decimals out of. The read is the same one every Blue recipe already
 * makes through `MorphoBlueAPI`, so this adds one round trip, not a new
 * dependency.
 */
export const morphoBlueLoanERC20Info = async (
  market: MarketParams,
  provider: Provider,
): Promise<RecipeERC20Info> => ({
  tokenAddress: market.loanToken,
  decimals: await new ERC20Contract(market.loanToken, provider).decimals(),
  isBaseToken: false,
});

/** The market's COLLATERAL token. Mirror of {@link morphoBlueLoanERC20Info}. */
export const morphoBlueCollateralERC20Info = async (
  market: MarketParams,
  provider: Provider,
): Promise<RecipeERC20Info> => ({
  tokenAddress: market.collateralToken,
  decimals: await new ERC20Contract(
    market.collateralToken,
    provider,
  ).decimals(),
  isBaseToken: false,
});

/**
 * Reject a combo whose swap leg would be a no-op self-swap.
 *
 * The Blue analogue of `assertSwapTokenIsNotCollateral`, and it takes a bare
 * address rather than a `RecipeERC20Info` on the market side: the market
 * descriptor has no decimals, and requiring them here would force an on-chain
 * read before a check that is pure address comparison. Constructors can
 * therefore run this, which is where a caller wants the error.
 *
 * `marketTokenRole` names which side of the market clashed. Getting it wrong is
 * not cosmetic — a Blue market's loan and collateral tokens are different
 * assets, so "already the collateral" sends a caller who actually passed the
 * loan token looking at the wrong argument.
 */
export const assertMorphoBlueSwapTokenDiffers = (
  callerERC20Info: RecipeERC20Info,
  marketTokenAddress: string,
  role: 'sell' | 'buy',
  comboName: string,
  recipeName: string,
  marketTokenRole: 'collateral' | 'loan',
): void => {
  if (
    callerERC20Info.tokenAddress.toLowerCase() ===
    marketTokenAddress.toLowerCase()
  ) {
    throw new Error(
      `${comboName}: ${role} token is already the market ${marketTokenRole} token (${marketTokenAddress}) — use ${recipeName} directly, no swap is needed`,
    );
  }
};

/**
 * One unit of the loan token, subtracted from the collateral-limited borrow
 * bound.
 *
 * **Measured, not defensive.** `Morpho.borrow` converts the requested assets to
 * shares with `toSharesUp`, then `_isHealthy` converts the position's shares
 * back with `toAssetsUp`. On a position with **no prior debt** both roundings
 * push the same way and the health check sees `assets + 1`, so drawing exactly
 * `maxBorrowAssets` reverts `insufficient collateral`.
 *
 * Verified on mainnet head (2026-08-05) via `eth_call` with a state override
 * placing collateral on a fresh account, binary-searching the largest accepted
 * borrow. The exact figures below are oracle-dependent and will not reproduce
 * at a later block; the INVARIANT — `max` reverts, `max - 1` succeeds — is what
 * this constant rests on, and it was reproduced independently on both markets.
 * (An earlier version of this comment named a specific block height that was
 * some twenty blocks PAST the tip when it was written, so it cannot have been
 * where the measurement was taken. A coordinate nobody can re-run at is worse
 * than none.):
 *
 * | market | collateral | `maxBorrowAssets` | largest accepted |
 * |---|---|---|---|
 * | wstETH/USDC 86 % (`0xb32349…86cc`) | 1 wstETH | `2003530713` | `2003530712` |
 * | wstETH/WETH 94.5 % (`0xc54d7a…ec41`) | 0.1 wstETH | `117222197085000000` | `117222197084999999` |
 *
 * The same sweep on a position that ALREADY carries debt measured a gap of
 * zero, because `borrowAssetsForShares` reports the existing debt with
 * `toAssetsUp` too and that over-statement cancels the borrow-side rounding.
 * So the unit is only needed on the case this seam actually builds — a fresh
 * open — and subtracting it on the other case costs one wei of capacity.
 *
 * Note this contradicts the note on `MorphoBluePositionRisk.borrowableAssets`,
 * which says fuzzing found no state where drawing exactly that figure reverts.
 * That field is left as-is (it is a reader, and de-rating a reported capacity
 * would make it wrong for every consumer); the de-rate belongs here, in the
 * builder that has to produce a number the chain will accept.
 *
 * The **liquidity** bound needs no such unit: `borrow` requires
 * `totalBorrowAssets <= totalSupplyAssets`, so borrowing exactly the free
 * liquidity leaves them equal and passes. Measured on the same market —
 * `borrow(2782135708226)` accepted, `borrow(2782135708227)` reverted
 * `insufficient liquidity`.
 */
export const MORPHO_BLUE_BORROW_ROUNDING_UNIT = 1n;

export type MorphoBlueBorrowCeilingInputs = {
  /** Collateral the position will hold when the borrow executes. */
  collateral: bigint;
  /**
   * Debt already booked against the owner, in loan-token native units and
   * interest-accrued — `MorphoBluePositionRisk.borrowAssets`, never the raw
   * `borrowShares`.
   */
  existingBorrowAssets: bigint;
  /** `MorphoBlueMarket.oraclePrice`, passed through verbatim. */
  oraclePrice: bigint;
  lltv: bigint;
  /** `MorphoBlueMarket.liquidityAssets` — market-wide, accrual-adjusted. */
  liquidityAssets: bigint;
};

export type MorphoBlueBorrowCeiling = {
  /** LLTV bound, de-rated by {@link MORPHO_BLUE_BORROW_ROUNDING_UNIT}. */
  collateralLimited: bigint;
  /** Market-liquidity bound. Exact — see the rounding-unit docs. */
  liquidityLimited: bigint;
  /** `min` of the two: the largest borrow this build may encode. */
  ceiling: bigint;
  /** Which bound produced `ceiling`, so an error can say what to change. */
  bound: 'collateral' | 'liquidity';
};

/**
 * The largest borrow a build may encode against a stated collateral.
 *
 * Pure — the caller supplies market and position state, so the arithmetic is
 * testable without a provider and one market read can serve several sizings.
 *
 * **It is a build-time bound, not a risk opinion.** A borrow at `ceiling` is
 * accepted by the chain and instantly one wei of price movement from
 * liquidation; nothing here refuses it, because refusing a valid transaction on
 * a risk judgement the caller did not ask for is not this layer's job. The
 * quote builders return the resulting health factor and liquidation price
 * alongside, which is the honest way to say the same thing.
 */
export const morphoBlueBorrowCeiling = (
  inputs: MorphoBlueBorrowCeilingInputs,
): MorphoBlueBorrowCeiling => {
  const { collateral, existingBorrowAssets, oraclePrice, lltv, liquidityAssets } =
    inputs;
  if (liquidityAssets < 0n) {
    throw new Error(
      `morpho: liquidityAssets must be >= 0 (got ${liquidityAssets})`,
    );
  }
  const risk = computeMorphoBlueRisk({
    collateral,
    borrowAssets: existingBorrowAssets,
    oraclePrice,
    lltv,
  });
  const derated =
    risk.borrowCapacityRemaining > MORPHO_BLUE_BORROW_ROUNDING_UNIT
      ? risk.borrowCapacityRemaining - MORPHO_BLUE_BORROW_ROUNDING_UNIT
      : 0n;
  const ceiling = derated < liquidityAssets ? derated : liquidityAssets;
  return {
    collateralLimited: derated,
    liquidityLimited: liquidityAssets,
    ceiling,
    bound: derated <= liquidityAssets ? 'collateral' : 'liquidity',
  };
};
