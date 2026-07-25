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
| `MorphoBlueRepayAndWithdrawCollateralRecipe` | approve + repay (assets) + withdrawCollateral (partial close) |
| `MorphoBlueClosePositionRecipe` | approve + **repay-by-shares** (full) + withdraw-all-collateral (full close) |
| `MorphoBlueBorrowRecipe` | borrow only — non-atomic follow-up on a position the same EOA opened earlier |
| `MorphoBlueRepayRecipe` | repay only (assets) |
| `MorphoBlueSetAuthorizationRecipe` | authorize/revoke an operator (retained-account / Bundler3 model) |

`MorphoBlueAPI` also exposes `getRepaySharesQuote` (reads `position.borrowShares` + market
state; conservative loan budget) and `getWithdrawAllCollateralQuote` (reads
`position.collateral`). `borrowAssetsForShares` exposes the round-up shares→assets conversion.
Repay-by-shares is preferred for full closes — it avoids debt growth between build and inclusion.

`MorphoBlueAPI`: `getMarketParamsFromId`, `getPosition`, `getSupplyCollateralQuote`,
`getBorrowQuote`, `getRepayQuote`, `getWithdrawCollateralQuote`.

Accounting: supply/repay consume an exact input (change reshields); borrow/withdraw produce
a deterministic token with no input consumed (the RAILGUN validator only constrains tokens
present in the input, so produced tokens are unconstrained).

### 5.1 Liquidation — OUT OF SCOPE (dropped)

Third-party liquidation is **not** provided, and is not a planned addition.

A RAILGUN liquidation cannot win a competitive race: proof generation alone costs seconds
and the broadcaster adds another hop, while liquidations are contested in-block by searchers
running bespoke bundles. In any market a bot actually watches, a position is taken the moment
it crosses the threshold.

Self-liquidation was considered as damage control (capturing your own liquidation incentive
instead of donating it to a searcher) and rejected for the same reason — you cannot outrun
the bot that is already watching your position. It would only land in long-tail markets that
searchers decline for lack of exit liquidity, which does not justify the maintenance surface.

**Self-cleansing is served by `MorphoBlueClosePositionRecipe`** (repay-by-shares +
withdraw-all-collateral), which operates on a healthy position and involves no liquidation
path — Morpho's `liquidate` reverts on a healthy position (`HEALTHY_POSITION`) and so could
never serve that case anyway.

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

## 7. High-value combo-meals

A `ComboMeal` chains whole recipes (skipUnshield on all but the first, skipShield on all but
the last), threading one recipe's shielded outputs into the next — distinct from the
multi-step recipes above. Combo-meals are exported at the package root
(`src/combo-meals/index.ts`).

### 7.1 Private vault entry — SHIPPED
```
private asset → 0x swap (→ vault asset) → Morpho vault deposit → shield vault shares
```
`ZeroXSwap_MorphoVaultDeposit_ComboMeal` (`ZeroXV2SwapRecipe` → `MorphoVaultDepositRecipe`).

### 7.2 Private vault exit — SHIPPED
```
unshield vault shares → redeem → 0x swap → shield desired asset
```
`MorphoVaultRedeem_ZeroXSwap_ComboMeal` (`MorphoVaultRedeemRecipe` → `ZeroXV2SwapRecipe`).

### 7.3 Private borrow
- **Same-account (SHIPPED):** `MorphoBlueSupplyCollateralAndBorrowRecipe` — atomic
  supply+borrow with `onBehalf == msg.sender == the ephemeral EOA`; no authorization needed.
- **Retained-account:** the `MorphoBlueSetAuthorizationRecipe` / `setAuthorization` primitive
  is now available (§5) for the model where the position owner and acting account differ.
  Full Bundler3 wiring of that flow is expressed via the transaction compiler (§6).

### 7.4 Private close — SHIPPED
```
unshield loan asset → repay ALL debt by shares → withdraw ALL collateral → shield collateral + refund
```
`MorphoBlueClosePositionRecipe` (repay-by-shares + withdraw-all). Revoke-authorization (if the
retained-account model was used) via `MorphoBlueSetAuthorizationRecipe(authorized, false)`.

### 7.5 Private liquidation — DROPPED
Not shipped; see §5.1. Removed rather than deferred — MEV searchers take any liquidatable
position the moment it crosses, so neither the third-party nor the self-liquidation variant
is viable through RAILGUN's latency budget.

### 7.6 Status summary
Shipped: repay-by-shares, withdraw-all-collateral, full-close recipe, the two swap combo-meals
(vault entry / exit), and the `setAuthorization` primitive. Dropped: all liquidation (§5.1).
Remaining (optional, Mode-2 via the compiler): the full Bundler3-wired retained-account borrow.

---

## 8. File map

```
src/utils/7702/                          ephemeral-executor helpers
src/abi/{vault/morpho,morpho}/           MetaMorpho + MorphoBlue ABIs
src/contract/{vault/morpho,morpho}/      thin ethers wrappers
src/api/vault/morpho/                    MorphoVaultAPI (self-contained quotes)
src/api/morpho/                          MorphoBlueAPI, MorphoCompilerAPI
src/steps/vault/morpho/                  vault deposit/redeem/withdraw steps + util
src/steps/morpho/                        blue-*, transact steps + util
src/recipes/vault/morpho/                vault recipes (V1/V2)
src/recipes/morpho/                      blue market, close, set-authorization, transact recipes
src/combo-meals/morpho/                  swap-chained combos (vault entry / exit)
```

---

## 9. Verification status

- **Green now:** `tsc` (src + test configs), 32 unit tests, eslint, madge (no cycles).
- **On-chain verified** against live mainnet: `getMarketId` derivation, the V2 vault ABI
  (`asset`/`decimals`/`preview*`, `maxDeposit`=0).
- **NOT executed:** every `FORK-run-*` test gates on `shouldSkipForkTest` and requires an
  anvil mainnet fork. The transaction compiler has no fork test.
- **Deferred:** vault-list refresh (see `.claude/plans/.../VAULT-LIST-REFRESH.md`, not in-repo).
