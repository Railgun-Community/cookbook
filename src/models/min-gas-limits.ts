/* eslint-disable @typescript-eslint/no-inferrable-types */

// Combo Meals
//
// The generic floor, still UNMEASURED on the 7702 path. Combos that have not
// been measured individually keep it, and `ComboMeal.getComboMealOutput` raises
// whatever they declare to `max(config, ...recipes)`, so none can sit below its
// own worst leg. That aggregation is a safety net, not a measurement: it cannot
// know what the combo's own overhead adds on top of its dearest recipe.
export const MIN_GAS_LIMIT_COMBO_MEAL: bigint = 2_900_000n; // 2.741
// MEASURED on the 7702 path, 2026-08-13, and it is the one combo we know the
// generic floor was too low for.
//
//   cost floor          3_121_581   (max failing probe 3_107_177, block 25748101)
//   pre-check overhead    112_500   (BORROWED — the dearest measured sibling;
//                                    this combo has no overhead bisection of
//                                    its own)
//   K                   3_009_081   -> 3_010_000
//
// This is the §4.1 flow that failed on mainnet: unshield WETH, swap to wstETH,
// open the position. That batch carried 3_016_590 and ran out of gas at the
// shield. The measured floor is 3_121_581, which is ABOVE it — so the mainnet
// failure is reproduced and explained rather than inferred.
//
// Aggregation alone did not save it. The combo took the generic 2_900_000 and
// its dearest constituent is FXMINT_OPEN at 2_690_000, so `max(...)` returned
// 2_900_000 — still ~221k under the real floor. A combo costs more than the sum
// of its parts' declared floors because the swap leg and the extra shield
// request are not in any constituent's number.
//
// The overhead is borrowed, so K is bounded rather than pinned. The direction is
// safe: this combo carries MORE calldata than any leg measured (a swap plus an
// open), so its true overhead should be >= 112_500, which makes the real K
// SMALLER and this value slightly conservative. Measure it to tighten.
//
// One block only. Given that ADJUST's floor moved 1.3% between two dates, treat
// this as sized on a single sample of a quantity known to drift.
export const MIN_GAS_LIMIT_ZEROX_FXMINT_OPEN_COMBO: bigint = 3_010_000n;

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
//     cost floor 2026-08-05  2_992_187   (max failing 2_953_125)
//     cost floor 2026-08-13  3_031_250   (max failing 2_992_187, block 25742656)
//     pre-check overhead       112_500   (reproduced on both dates: forced
//                                         require K 4_000_000 -> 4_112_500)
//     K = 3_031_250 - 112_500
//                            2_918_750   -> 2_920_000
//
// Derived from the DEARER of the two measurements. Note what the second one
// says about the first: 2_992_187 was the measured floor on 2026-08-05 and is a
// FAILING probe on 2026-08-13. The cost rose by 39_063, about 1.3%, which is the
// tree-state spread F11 documents (~1%) rather than a change in the recipe.
//
// That is why this is 2_920_000 and not the 2_880_000 shipped before. The old
// value was correct for the state it was measured against and under-provisions
// against a dearer tree. A floor that is too low does not merely fail the
// harness window — it under-provisions the batch on chain.
//
// Two measurements is the minimum this deserves; the method calls for a spread
// across >= 3 blocks. Treat 2_920_000 as sized on the dearer of two rather than
// on a settled distribution, and widen it if a third comes in higher.
//
// The 3_000_000 before that over-constrained by ~120k. Sized on topup+borrow
// because it is the only member that moves BOTH axes of operate() and shields an
// ERC20 and the NFT back; one constant has to clear topup, borrow-more and
// repay-debt too.
export const MIN_GAS_LIMIT_FXMINT_ADJUST: bigint = 2_920_000n;
//   CLOSE — both branches measured 2026-08-13, and they do NOT coincide.
//     FULL  cost floor    3_109_375   (max failing 3_070_312, block 25742266)
//     PART  cost floor    3_031_250   (max failing 2_992_187, block 25742576)
//     pre-check overhead    112_500   (forced require K 4_000_000, floor with it
//                                      4_112_500, 5 probes)
//     K = 3_109_375 - 112_500
//                         2_996_875   -> 3_000_000
//
// Sized on the FULL close, because it is the dearer branch and one constant has
// to clear both. Sizing on the partial would give K = 2_918_750, which the full
// close would then breach.
//
// The earlier note had this BACKWARDS. It attributed 3_109_375 to the PARTIAL
// close and called that "the dearer branch, since the position survives and the
// NFT is shielded back". Two things are wrong with that. The rationale is
// superseded — f(x) does not burn on close (0 burns measured over 200k blocks)
// and the step declares the NFT unconditionally, so BOTH branches carry the
// shield leg. And the ordering is inverted: measured against the same fixture,
// the full close costs MORE. The gap is the repay size, not the NFT.
//
// The two are separated by more than the search can blur: the bracketing
// intervals (2_992_187, 3_031_250] and (3_070_312, 3_109_375] are disjoint, so
// the difference is real and at least 39_062 gas, not a lattice artefact.
//
// K is now PINNED rather than bounded. The overhead was previously carried as
// NOT MEASURED — the earlier re-bisection died when the squid returned 502
// mid-run — with ADJUST's 112_500 borrowed as a stand-in. The measurement
// returned exactly that, so the shipped value did not move; only its
// justification did.
//
// Read that agreement carefully before treating it as two independent results.
// Both overheads come from the same window [K, K + 600_000] at a 50_000
// tolerance, and 112_500 is a lattice point of it. Adjust and close agree to
// within the search's own resolution — which is not the same as being equal.
//
// Direction of error, if this is ever re-derived: over-provisioning is the
// harmful side. An excessive floor makes the batch carry gas it cannot use and
// can revert on the floor check itself, so prefer the LARGER overhead (which
// yields the smaller K) when two candidates are within the search resolution.
export const MIN_GAS_LIMIT_FXMINT_CLOSE: bigint = 3_000_000n;
export const MIN_GAS_LIMIT_LP_V2_ADD_LIQUIDITY: bigint = 2_700_000n; // 2.588
export const MIN_GAS_LIMIT_LP_V2_REMOVE_LIQUIDITY: bigint = 2_300_000n; // 2.194
export const MIN_GAS_LIMIT_TRANSFER: bigint = 1_900_000n; // 1.817
