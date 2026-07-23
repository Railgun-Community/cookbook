# Morpho + EIP-7702 Cookbook Addons — Implementation

Branch: `zy0n/7702-morpho-addons` (off `zy0n/7702-base-main`). Ethereum mainnet only.

This document describes the 7702 helper module and the Morpho recipe series added to the
cookbook, how they are structured, how to call them, and their verification status.

---

## 1. Execution model (EIP-7702)

Under the 7702 relay-adapt flow, a recipe's cross-contract batch executes as an **ephemeral
EOA** — a fresh account that authorizes the shared `RelayAdapt7702` implementation, receives
the unshielded assets, executes the recipe as `msg.sender`, re-shields the outputs, and is
then abandoned.

Every recipe that routes funds must point at *this* account (never the shared relay-adapt
contract). For un-tokenized Morpho Blue positions, the ephemeral EOA address is the **only**
handle to the position across separate (non-atomic) `execute()` batches.

### 1.1 `src/utils/7702/` — ephemeral-executor helpers

| Export | Purpose |
| --- | --- |
| `EphemeralExecutor` | Nominal, branded value object wrapping a checksummed address. |
| `makeEphemeralExecutor(addr)` | Validate + wrap a raw address. |
| `resolveExecutorAddress(EphemeralExecutor \| string)` | The single choke point every 7702-aware step routes its recipient/executor through. Returns a validated, checksummed string. |
| `assertValidExecutorAddress` | Alias of the canonical `assertValidRecipientAddress`. |
| `spentToExecutor(...)` | Build a spent-amount record routed to the resolved executor. |

The wrap/unwrap/transfer-base-token and transfer-erc20 adapt steps accept
`EphemeralExecutor | string` and validate at construction (fail-fast on a zero/malformed
address).

---

## 2. Routing decision — HYBRID

Routing is operation-dependent (`MorphoRoute = "direct-erc4626" | "morpho-sdk-bundler3"`):

- **`direct-erc4626` (default)** for simple one-shot vault ops: less gas, smaller trusted
  surface, no Bundler3 address dependency, exact narrow approval cleared immediately —
  ideal for a single-use 7702 account.
- **`morpho-sdk-bundler3`** only for compositions that need atomic multi-action (native/
  permit deposits, Blue ops via the SDK, refinance, flash-loan compositions). Exposed via
  the optional transaction compiler (§6), not baked into the direct recipes.

Direct ERC-4626 `deposit()` has no `minSharesOut`; transaction-level protection must come
from `RelayAdapt7702` asserting a share-balance delta. The recipes declare `[min, expected]`
bands for RAILGUN accounting and scope approvals to the exact amount.

---

## 3. Self-contained recipe pattern

Every Morpho recipe is **self-contained** (0x-V2 `ZeroXV2Quote` style): the recipe queries
its own on-chain data via an API class and validates the 7702 executor. Callers pass only
the target (vault/market), an amount, the executor, and a provider — never pre-fetched
rates. Pure steps then consume the produced quote.

```
Recipe (holds provider + executor)
  └─ getInternalSteps(): fetch quote via <Api>.get*Quote(...)   ← on-chain reads
       └─ [ ApproveERC20SpenderStep(exact amount), <Pure>Step(quote) ]
```

---

## 4. Vault recipes (`src/recipes/vault/morpho/`, `src/api/vault/morpho/`)

MetaMorpho (Vault V1) and Morpho Vault V2 share the same ERC-4626 surface, so one base
recipe serves both; thin `V1`/`V2` subclasses only set the config label. **Vault V2
`maxDeposit()` returns 0 by spec** — the API uses only `preview*`, so it is V2-safe.

| Recipe | Semantics |
| --- | --- |
| `MorphoVault{V1,V2}DepositRecipe` | `approve(exact)` + `deposit(assets, receiver=EOA)`. Shares out are non-deterministic → `[minShares, expectedShares]`. |
| `MorphoVault{V1,V2}RedeemRecipe` | `redeem(shares, receiver=EOA, owner=EOA)`. Shares-denominated (burns exact input shares); assets out non-deterministic. No approval leg. |
| `MorphoVault{V1,V2}WithdrawRecipe` | `withdraw(assets, receiver=EOA, owner=EOA)`. Assets-denominated (exact asset out); shares burned drift, so a conservative `maxShares` is spent and the remainder reshields. Caller must unshield ≥ `maxShares`. |

`MorphoVaultAPI`: `getVaultData`, `getDepositQuote`, `getRedeemQuote`, `getWithdrawQuote`.

```ts
const recipe = new MorphoVaultV1DepositRecipe(vaultAddress, 50n /*bps*/, executor, provider);
const output = await recipe.getRecipeOutput(recipeInput);
```

Registries: `KNOWN_METAMORPHO_VAULTS` (V1) and `KNOWN_MORPHO_VAULTS_V2`
(`steakPrimeUSDC = 0xbeef088055857739C12CD3765F20b7679Def0f51`, verified on-chain).

---

## 5. Morpho Blue market recipes (`src/recipes/morpho/`, `src/api/morpho/`, `src/steps/morpho/`)

Morpho Blue singleton: `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`.
`MarketParams = (loanToken, collateralToken, oracle, irm, lltv)`;
`marketId = keccak256(abi.encode(marketParams))` (`getMarketId`, verified against a live
market). Positions are **un-tokenized**: `onBehalf == receiver ==` the ephemeral EOA; only
fungible change/borrowed/withdrawn tokens shield back.

| Recipe | Steps |
| --- | --- |
| `MorphoBlueSupplyCollateralAndBorrowRecipe` | approve + supplyCollateral + borrow (open, one batch) |
| `MorphoBlueRepayAndWithdrawCollateralRecipe` | approve + repay + withdrawCollateral (close) |
| `MorphoBlueBorrowRecipe` | borrow only — non-atomic follow-up on a position the same EOA opened earlier |
| `MorphoBlueRepayRecipe` | repay only |
| `MorphoBlueLiquidationRecipe` | approve + liquidate (see §5.1) |

`MorphoBlueAPI`: `getMarketParamsFromId`, `getPosition`, `getSupplyCollateralQuote`,
`getBorrowQuote`, `getRepayQuote`, `getWithdrawCollateralQuote`, `getLiquidationQuote`.

Accounting: supply/repay consume an exact input (change reshields); borrow/withdraw produce
a deterministic token with no input consumed (the RAILGUN validator only constrains tokens
present in the input, so produced tokens are unconstrained).

### 5.1 Liquidation

`liquidate` has no address params — seized collateral goes to, and repaid loan is pulled
from, `msg.sender` (the ephemeral EOA). Seize-mode seizes an exact collateral amount; the
loan pulled is computed on-chain via a faithful port of Morpho's math
(`liquidationIncentiveFactor` + shares math, `computeRepaidAssetsFromSeized`), both covered
by known-answer unit tests. The step spends a conservative `maxRepaidAssets` (never
shortfalls) and reshields the remainder; the caller unshields ≥ `maxRepaidAssets`.

---

## 6. Morpho transaction compiler — OPTIONAL / EXTRA

`src/api/morpho/morpho-compiler.ts`, `src/steps/morpho/morpho-transact-step.ts`,
`src/recipes/morpho/morpho-transact-recipe.ts`.

This is an **optional** Mode-2 escape hatch — NOT required by anything else. It runs an
arbitrary Morpho-SDK-built bundle through Cookbook so complex routing stays in Morpho's
maintained SDK. It adds no capability the direct recipes lack.

- `MorphoBundle` — SDK-agnostic: `{ initiator, calls[], pulls[], outputs[] }`. The
  `@morpho-org` SDK is intentionally **not** a dependency; the caller supplies a
  `bundleBuilder`.
- `MorphoCompilerAPI.assertBundleSafe` — enforces: no approval targets **Bundler3**
  (`0x6566…0245`; approve GeneralAdapter1 `0x4a6c…0ae0` or the target instead), the
  initiator matches the executor, amounts/addresses are sane.
- The ephemeral EOA must be the direct Bundler3 caller (adapter `initiator`) — enforced by
  the wallet layer (`msg.sender`).

**Caveats:** least-validated module — no end-to-end/fork exercise, and the bundle's declared
pulls/outputs are trusted from the caller (shape + no-Bundler3-approval are checked, but not
that the raw calldata matches the declared effects).

---

## 7. High-value combo-meals — NOT YET IMPLEMENTED (planned)

No Morpho combo-meals exist yet. A `ComboMeal` chains whole recipes (skipUnshield on all but
the first, skipShield on all but the last), threading one recipe's shielded outputs into the
next — distinct from the multi-step recipes above. Reference:
`combo-meals/liquidity-vault/uni-v2-like-add-liquidity-beefy-deposit-combo-meal.ts`.

The target flows and their build-readiness against what is shipped:

### 7.1 Private vault entry — BUILDABLE NOW
```
private asset → [optional private swap] → Morpho Vault V2 deposit → shield vault shares
```
Chain: `ZeroXV2SwapRecipe` (→ vault asset) → `MorphoVaultV2DepositRecipe`. Both exist.

### 7.2 Private vault exit — BUILDABLE NOW
```
unshield vault shares → redeem → [optional swap] → shield desired asset
```
Chain: `MorphoVaultV2RedeemRecipe` → `ZeroXV2SwapRecipe`. Both exist.

### 7.3 Private borrow — PARTIAL (needs authorization for the retained-account model)
```
unshield collateral → supply collateral (position account)
  → authorize GeneralAdapter1 → borrow (to execution account) → shield borrowed asset
```
- **Same-account model (shipped):** `MorphoBlueSupplyCollateralAndBorrowRecipe` already does
  atomic supply+borrow with `onBehalf == msg.sender == the ephemeral EOA` — no
  authorization needed, because the position owner *is* the borrower.
- **Retained-position-account model (gap):** if the collateral position is owned by a
  *persistent* account separate from the ephemeral execution account, Morpho requires
  `setAuthorization` (or GeneralAdapter1 authorization via the SDK/Bundler3 path). Not built —
  needs an authorization primitive (Mode-2 / §6 territory).

### 7.4 Private close — PARTIAL (needs repay-by-shares)
```
unshield loan asset → repay debt BY SHARES → withdraw all collateral
  → revoke GeneralAdapter1 authorization → shield collateral + refund
```
- **repay-by-shares — GAP.** The shipped `MorphoBlueRepayStep` is assets-denominated only.
  Closing by borrow **shares** avoids debt growth between recipe build and inclusion, so this
  needs a shares-mode repay quote/step (read `position(id, EOA).borrowShares`, repay with
  `shares` not `assets`).
- **withdraw-all-collateral:** read `position(id, EOA).collateral` for the amount — small
  addition on top of the shipped `MorphoBlueWithdrawCollateralStep`.
- **revoke authorization:** only relevant under the retained-account model (§7.3).

### 7.5 Private liquidation — MOSTLY BUILDABLE NOW
```
unshield repayment asset → liquidate → receive seized collateral → [optional swap] → shield profit
```
Chain: `MorphoBlueLiquidationRecipe` → `ZeroXV2SwapRecipe`. Both exist. A later version could
combine a Morpho flash loan + liquidate + collateral sale + repay, shielding only net profit —
a Mode-2 (Bundler3 flash-loan) composition, not built.

### 7.6 Gaps these combos require (build order)
1. **repay-by-shares** step/quote (`MorphoBlueRepayStep` shares-mode) — needed for §7.4, small.
2. **withdraw-all-collateral** helper (read position collateral) — §7.4, small.
3. **swap-chained combo-meals** under `src/combo-meals/morpho/` for §7.1, §7.2, §7.5 — reuse
   shipped recipes unchanged, medium.
4. **Morpho authorization primitive** (`setAuthorization` / GeneralAdapter1) — §7.3, §7.4
   retained-account model, Mode-2, larger.
5. **Flash-loan liquidation composition** — §7.5 advanced, Bundler3, largest.

---

## 8. File map

```
src/utils/7702/                          ephemeral-executor helpers
src/abi/{vault/morpho,morpho}/           MetaMorpho + MorphoBlue ABIs
src/contract/{vault/morpho,morpho}/      thin ethers wrappers
src/api/vault/morpho/                    MorphoVaultAPI (self-contained quotes)
src/api/morpho/                          MorphoBlueAPI, MorphoCompilerAPI
src/steps/vault/morpho/                  vault deposit/redeem/withdraw steps + util
src/steps/morpho/                        blue-*, liquidate, transact steps + util
src/recipes/vault/morpho/                vault recipes (V1/V2)
src/recipes/morpho/                      blue market, liquidation, transact recipes
```

---

## 9. Verification status

- **Green now:** `tsc` (src + test configs), 29 unit tests, eslint, madge (no cycles).
- **On-chain verified** against live mainnet: `getMarketId` derivation, liquidation-incentive
  factor + repaid-assets math, the V2 vault ABI (`asset`/`decimals`/`preview*`, `maxDeposit`=0).
- **NOT executed:** every `FORK-run-*` test gates on `shouldSkipForkTest` and requires an
  anvil mainnet fork. The liquidation fork test additionally needs a liquidatable-position
  fixture (pinned fork block or oracle override). The transaction compiler has no fork test.
- **Deferred:** vault-list refresh (see `.claude/plans/.../VAULT-LIST-REFRESH.md`, not in-repo).
