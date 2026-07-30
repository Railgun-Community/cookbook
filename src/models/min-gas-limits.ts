/* eslint-disable @typescript-eslint/no-inferrable-types */

// Combo Meals
export const MIN_GAS_LIMIT_COMBO_MEAL: bigint = 2_900_000n; // 2.741

// Recipes
export const MIN_GAS_LIMIT_ANY_RECIPE: bigint = 2_800_000n;
export const MIN_GAS_LIMIT_EMPTY: bigint = 1_800_000n; // 1.783
export const MIN_GAS_LIMIT_EMPTY_SHIELD: bigint = 2_600_000n;
export const MIN_GAS_LIMIT_0X_SWAP: bigint = 2_400_000n; // 1.916
export const MIN_GAS_LIMIT_0X_SWAP_TRANSFER: bigint = 2_500_000n;
export const MIN_GAS_LIMIT_0X_SWAP_SHIELD: bigint = 2_700_000n;
export const MIN_GAS_LIMIT_BEEFY_VAULT_DEPOSIT: bigint = 3_100_000n; // 2.667 (3.113 for a different vault)
export const MIN_GAS_LIMIT_BEEFY_VAULT_WITHDRAW: bigint = 3_000_000n; // 2.603 (3.012 for a different vault...)
export const MIN_GAS_LIMIT_METAMORPHO_DEPOSIT: bigint = 2_900_000n;
export const MIN_GAS_LIMIT_METAMORPHO_WITHDRAW: bigint = 2_800_000n;
export const MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW: bigint = 3_100_000n;
export const MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW: bigint = 3_000_000n;
export const MIN_GAS_LIMIT_MORPHO_BLUE_BORROW: bigint = 2_700_000n;
export const MIN_GAS_LIMIT_MORPHO_BLUE_REPAY: bigint = 2_700_000n;
export const MIN_GAS_LIMIT_MORPHO_TRANSACT: bigint = 3_100_000n;
// f(x) Protocol (fxMINT), long and short pools.
//
// STILL NOT MEASURED — no fx recipe has ever executed on a fork. But the
// previous values (open 1.5M, adjust 1.5M, close 2.5M, carried verbatim from the
// v0.1 per-recipe hardcodes) were provably too low, independent of measurement:
//
//   MIN_GAS_LIMIT_EMPTY is 1.8M, from a real measurement of 1.783M for a recipe
//   that does nothing but unshield and shield. Every fx recipe does that PLUS an
//   ERC20 approve PLUS a PoolManager.operate() that mints or burns an ERC-721.
//   A floor of 1.5M was therefore below the cost of the empty case it strictly
//   contains, and too-low floors under-provision the batch rather than merely
//   failing the harness's [min-200k, min+50k] window.
//
// Re-anchored against the measured neighbours in this file rather than invented:
// beefy deposit 3.1M, morpho blue supply+borrow 3.1M, 0x swap 2.4M — all
// unshield + approve + one protocol call, the same shape as an fx op. The NFT
// mint/burn puts fx at the top of that band, not the bottom.
//
// Short pools are sized by the same constants deliberately. They are strictly
// more expensive than longs: ShortPoolManager._handleBorrow calls into the LONG
// manager (`ILongPoolManager(counterparty).borrow(...)`) to source the debt
// token, so a short open/borrow carries an extra cross-contract hop. One set of
// constants sized for the dearer side is safer than two sets where the cheaper
// one can be applied to the dearer path by mistake.
//
// Treat all three as upper-bounded guesses pending the 7702 fork harness
// (.claude/plans/7702-execute-fork-harness). They are deliberately generous:
// over-provisioning costs allowance, under-provisioning reverts the batch.
export const MIN_GAS_LIMIT_FXMINT_OPEN: bigint = 3_100_000n;
export const MIN_GAS_LIMIT_FXMINT_ADJUST: bigint = 3_000_000n;
export const MIN_GAS_LIMIT_FXMINT_CLOSE: bigint = 3_100_000n;
export const MIN_GAS_LIMIT_LP_V2_ADD_LIQUIDITY: bigint = 2_700_000n; // 2.588
export const MIN_GAS_LIMIT_LP_V2_REMOVE_LIQUIDITY: bigint = 2_300_000n; // 2.194
export const MIN_GAS_LIMIT_TRANSFER: bigint = 1_900_000n; // 1.817
