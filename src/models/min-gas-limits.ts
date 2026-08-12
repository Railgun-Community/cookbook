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
// MEASURED on the 7702 path, 2026-08-05, wstETH/USDC 86% market (0.05 wstETH
// collateral, 50 USDC drawn). Same derivation as the fx constants:
//
//   cost floor          2_093_750   (max failing probe 2_078_125)
//   pre-check overhead     93_750
//   K                   2_000_000
//
// The old 3_100_000 over-constrained by ~1.1M — the largest error in this file,
// and in the harmful direction: an excessive floor makes every supply+borrow
// batch carry gas it cannot use and can revert on the floor check itself.
//
// Note it lands BELOW every fx leg. That is not suspicious: Blue's
// supplyCollateral + borrow is two calls against a singleton with no NFT to
// mint and no position token to shield, where fx open mints an ERC-721 and
// shields it.
export const MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW: bigint = 2_000_000n;
// MEASURED 2026-08-06, same fixture and derivation as SUPPLY_BORROW above. The
// pre-check overhead is the 93_750 measured on that leg — Blue's legs carry
// comparable calldata, and it is the only Blue overhead measured. Re-measure per
// leg to tighten.
//
//   repay + withdraw   cost 2_234_375 (max failing 2_218_750)  K 2_140_625
//   repay              cost 1_984_375 (max failing 1_968_750)  K 1_890_625
//
// The ordering is the sanity check: repay < supply+borrow (2_093_750) <
// repay+withdraw, which is what the call counts predict.
export const MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW: bigint = 2_150_000n;
// STILL UNMEASURED — no fixture leg exercises a bare borrow against an existing
// position. It does strictly less than supply+borrow (measured cost 2_093_750),
// so this 2_700_000 is over-provisioned by roughly the same margin the others
// were. Left high rather than guessed downward.
export const MIN_GAS_LIMIT_MORPHO_BLUE_BORROW: bigint = 2_700_000n;
// Also covers the lend side (`MorphoBlueSupplyLoanRecipe`), which reuses this
// constant. That leg did not measure — the third bisection in a process wedges,
// the poller-resume symptom documented in the fx position file — but it is one
// approve plus one Blue call, the same shape as repay and strictly simpler than
// repay+withdraw, so a floor sized on repay covers it.
export const MIN_GAS_LIMIT_MORPHO_BLUE_REPAY: bigint = 1_900_000n;
export const MIN_GAS_LIMIT_MORPHO_TRANSACT: bigint = 3_100_000n;
// f(x) Protocol (fxMINT), long and short pools.
//
// All three of open / adjust / close are now MEASURED on the 7702 path; the
// per-constant blocks below carry the figures, the date, and the derivation.
// This header said "STILL NOT MEASURED ... treat all three as upper-bounded
// guesses" long after that stopped being true, which reads as a licence to
// re-guess them. It is not — do not move these without re-running the bisection.
//
// The history is still worth keeping, because it explains the shape of the
// error: the v0.1 hardcodes (open 1.5M, adjust 1.5M, close 2.5M) were provably
// too low independent of measurement, since MIN_GAS_LIMIT_EMPTY covers a recipe
// that only unshields and shields, and every fx recipe does that PLUS an approve
// PLUS a PoolManager.operate() that mints or burns an ERC-721. Measurement then
// moved them in BOTH directions — see the note on FXMINT_OPEN, which was ~421k
// too high once measured. A uniform correction would have been wrong.
//
// Short pools are sized by the same constants deliberately. They are strictly
// more expensive than longs: ShortPoolManager._handleBorrow calls into the LONG
// manager (`ILongPoolManager(counterparty).borrow(...)`) to source the debt
// token, so a short open/borrow carries an extra cross-contract hop. One set of
// constants sized for the dearer side is safer than two sets where the cheaper
// one can be applied to the dearer path by mistake.
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
// MEASURED on the 7702 path, 2026-08-05, against a fixture that opens a
// wstETH-Long position first (adjust and close are not expressible without one).
// Same derivation as the two above: K = cost floor - pre-check overhead.
//
//   ADJUST (topup + borrow, the dearest member of the family)
//     cost floor          2_992_187   (max failing probe 2_953_125)
//     pre-check overhead    112_500   (measured, require-bound re-bisection)
//     K                   2_879_687   -> 2_880_000
//
// The old 3_000_000 over-constrained by ~120k. Sized on topup+borrow because it
// is the only member that moves BOTH axes of operate() and shields an ERC20 and
// the NFT back; one constant has to clear topup, borrow-more and repay-debt too.
export const MIN_GAS_LIMIT_FXMINT_ADJUST: bigint = 2_880_000n;
//   CLOSE (partial — the dearer branch, since the position survives and the NFT
//   is shielded back)
//     cost floor          3_109_375   (max failing probe 3_070_312)
//     pre-check overhead    NOT MEASURED — the re-bisection died when the squid
//                           returned 502 mid-run and wedged the TXID sync.
//
// So K is bounded, not pinned: K = 3_109_375 - overhead, and overhead is
// strictly positive. Using ADJUST's measured 112_500 gives 2_996_875. That is
// the LARGER of the two sibling overheads (OPEN measured 87_377), and using the
// larger one is deliberate — it yields the SMALLER K, and over-provisioning is
// the harmful direction here: an excessive floor makes the batch carry gas it
// cannot use and can revert on the floor check itself.
//
// Re-measure the close overhead to replace this bound with a measurement. Until
// then the assumption is stated rather than hidden: close carries at least as
// much calldata as adjust, so its overhead should be >= 112_500, which would
// make this value slightly conservative rather than slightly high.
export const MIN_GAS_LIMIT_FXMINT_CLOSE: bigint = 3_000_000n;
export const MIN_GAS_LIMIT_LP_V2_ADD_LIQUIDITY: bigint = 2_700_000n; // 2.588
export const MIN_GAS_LIMIT_LP_V2_REMOVE_LIQUIDITY: bigint = 2_300_000n; // 2.194
export const MIN_GAS_LIMIT_TRANSFER: bigint = 1_900_000n; // 1.817
