/* eslint-disable @typescript-eslint/no-inferrable-types */

// Combo Meals
export const MIN_GAS_LIMIT_COMBO_MEAL: bigint = 2_900_000n; // 2.741

// Recipes
export const MIN_GAS_LIMIT_ANY_RECIPE: bigint = 2_800_000n;
// MEASURED on the 7702 path, 2026-08-04. See FORK-measure-7702-gas-floors.
//
// This value is NOT the batch's gas cost — it becomes `actionData.minGasLimit`,
// which RelayAdapt enforces as `gasleft() >= K` *after* intrinsic and calldata
// gas is already spent. So it is the cost minus that pre-check overhead:
//
//   cost floor          1_880_004   (bisected, identical at 4 fork blocks)
//   pre-check overhead     77_269   (measured by forcing K high and re-bisecting)
//   K = cost - overhead 1_802_735   -> rounded up for margin
//
// The old 1_800_000 came from a relay-adapt measurement (1.783M) and was very
// nearly right by luck; it left a ~2.7k window in which a batch clears the
// require and still runs out of gas.
export const MIN_GAS_LIMIT_EMPTY: bigint = 1_810_000n;
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
// MEASURED on the 7702 path, 2026-08-04 (wstETH-Long, 5 fxUSD against 0.02
// wstETH). Same derivation as MIN_GAS_LIMIT_EMPTY — K is the cost minus the
// pre-check overhead, not the cost itself:
//
//   cost floor          2_766_112   (bisected, reproduced at 2 fork blocks)
//   pre-check overhead     87_377   (larger than EMPTY's: more calldata)
//   K = cost - overhead 2_678_735   -> rounded up for margin
//
// The old 3_100_000 OVER-constrained by ~421k: it forced every fx open batch to
// carry gas it could not use, which is the failure mode the file's own comment
// warns about ("an excessive floor makes the transaction carry gas it cannot
// use and can revert the estimate on the floor check itself").
//
// Note the direction. EMPTY was ~2.7k too LOW and this was ~421k too HIGH, so
// no uniform correction — least of all "raise everything above the SDK's 3.2M
// default" — would have been right for both.
//
// Tree state moves the cost by ~1% (2_766_112 cold vs 2_737_059 against a fork
// carrying prior shields), so K is derived from the COLD figure; a value tuned
// to the warm one under-provisions a position opened against a fresh subtree.
export const MIN_GAS_LIMIT_FXMINT_OPEN: bigint = 2_690_000n;
// STILL UNMEASURED. Both are adjust-family ops and are probably nearer OPEN's
// measured cost than these inherited guesses, but neither has been bisected —
// they need a fixture that opens a position first, since open is the only fx leg
// expressible without one. Left high deliberately: over-provisioning is the
// safer error while the number is unknown.
export const MIN_GAS_LIMIT_FXMINT_ADJUST: bigint = 3_000_000n;
export const MIN_GAS_LIMIT_FXMINT_CLOSE: bigint = 3_100_000n;
export const MIN_GAS_LIMIT_LP_V2_ADD_LIQUIDITY: bigint = 2_700_000n; // 2.588
export const MIN_GAS_LIMIT_LP_V2_REMOVE_LIQUIDITY: bigint = 2_300_000n; // 2.194
export const MIN_GAS_LIMIT_TRANSFER: bigint = 1_900_000n; // 1.817
