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
// f(x) Protocol (fxMINT). Values carried over verbatim from the per-recipe
// hardcodes they replace — NOT recalibrated. The fork harness asserts gas within
// [minGasLimit - 200k, minGasLimit + 50k], so these want a real measurement once
// a standalone fx recipe runs on a fork.
export const MIN_GAS_LIMIT_FXMINT_OPEN: bigint = 1_500_000n;
export const MIN_GAS_LIMIT_FXMINT_ADJUST: bigint = 1_500_000n;
export const MIN_GAS_LIMIT_FXMINT_CLOSE: bigint = 2_500_000n;
export const MIN_GAS_LIMIT_LP_V2_ADD_LIQUIDITY: bigint = 2_700_000n; // 2.588
export const MIN_GAS_LIMIT_LP_V2_REMOVE_LIQUIDITY: bigint = 2_300_000n; // 2.194
export const MIN_GAS_LIMIT_TRANSFER: bigint = 1_900_000n; // 1.817
