# 2.13.0-rc.2 — release candidate

Branch `zy0n/7702-morpho-addons`, cut onto `origin/release`. 265 files changed
against `2.12.4`.

The theme: an EIP-7702 ephemeral executor makes **the account the position
handle**, so address-bound protocols — Morpho Blue, f(x) positions — become
expressible behind RAILGUN for the first time. Everything below follows from
that.

## If you are already on the `dev` tag, upgrade

`2.13.0-rc.0` and `2.13.0-rc.1` are published and `dev` currently points at
`rc.1`. **That build has a broken f(x) write path** — it predates the fix by 96
commits, so on it:

- a full close reverts on both LONG pools and panics on `WBTC-Short`
- a repay that clears the whole debt always reverts
- `getFxDebtScalingFactor` throws on both LONG pools
- a *successful* full close leaves the position NFT public

All four are fixed here. If you are pinned to `rc.1`, treat this as a required
upgrade rather than an optional one; see **Fixes** below for what each one did.

The `2.13.0-fx.N` tarballs were private test builds and were never published.

---

## Breaking changes

**There are four against `2.12.4`.** `docs/MIGRATION-7702-fx-morpho.md` covers
the two most recent in depth, because it was written for testers already on
`-fx.2`. Anyone coming from `2.12.4` gets all four. Read this section first.

Every one of them shares a property worth stating plainly: taken alone, each
leaves a call site that **still compiles and produces wrong on-chain behaviour**
rather than an error. Migrate them together.

### 1. f(x) close and repay take native units — `1fae095`

`computeFxClose` / `computeFxRepay` compared a **raw** debt figure against
**native** amounts. Long pools report debt native and collateral raw; shorts
report the reverse. On `WBTC-Short` (raw = native × 10^10) a caller passing
`position.rawDebts` got three simultaneous failures: a `repayAmount` above the
debt, a `withdrawColl` of 1.017e-8 % of the position, and `partialClose` stuck
`true` so a full close ran the partial branch.

`assertNativeDebt` now throws rather than letting it through — a plain-JS caller
comparing `undefined < bigint` gets `false`, which silently disables the ceiling.

→ Full diff and field renames in the migration note, §1.

### 2. Morpho Blue quote builders take `owner` / `receiver` — `76ecf61`

The single `recipient` field conflated the durable position owner with the
batch-local payee. Under 7702 those are genuinely different addresses.

→ Migration note, §2.

### 3. f(x) steps are driven by the pool descriptor — `f64731d`

The three fx steps hardcoded `FX_ADDRESSES.fxUSD` as the debt token and
`fxPoolManager` as the callee. Neither holds for short pools, which borrow the
volatile asset and live on a different manager. The step data types now take
`pool: ResolvedFxPool` in place of the flat
`pool`/`collateralToken`/`collateralDecimals` triple.

**Scope:** only the six fx recipes and their tests construct these steps, so the
recipe surface most consumers use is unchanged apart from the additive
`withdrawFeeRatio` opt. If you construct fx *steps* directly, this is breaking.

Behaviour that moved with it: close/withdraw outputs are now net of
`withdrawFeeRatio` — zero on longs, so long behaviour is byte-identical; 0.1% on
shorts, where declaring the gross over-stated the reshielded collateral.

### 4. fxMINT recipes are single-protocol — `39ce61d`

`swapQuote` and `slippageBasisPoints` are **removed** from `FxMintOpenRecipe`,
`FxMintCloseRecipe`, `FxMintTopupRecipe` and `FxMintTopupAndBorrowRecipe`;
`validatePoolFlow` and `SwapDirection` are no longer exported.

Those recipes embedded a 0x leg and made the caller fetch a quote against an
amount only knowable *after* the unshield fee — so a quote taken for the gross
balance failed the swap step's own input check. The input token was hardcoded to
WETH besides.

**Upgrade:** entering or exiting from another asset is now a ComboMeal's job. Use
`ZeroXSwap_FxMintOpen_ComboMeal` and its siblings. A caller passing WETH for
`wstETH-Long` now gets an explicit `fxmint: no <collateral> in
input.erc20Amounts` instead of a silent swap.

---

## What's new

**f(x), both sides.** Long and short pools throughout — position readers,
combo-meals, fee model. Open / topup / borrow-more / repay / close, plus
combo-meals to enter and exit from any token. An open **preflight** that checks
the `onlyTopLevelCall` whitelist and the resulting debt ratio, instead of
discovering the failure on chain.

**Morpho.** Blue market steps and recipes across supply / borrow / repay /
withdraw, both the borrow and lend sides, seven swap-chained combos with
build-time affordability checks, MetaMorpho V1/V2 vault recipes with gated-vault
detection, on-chain market and vault discovery, a health/liquidation reader, and
a generic SDK-bundle→recipe compiler. Blue authorizations are scoped to the batch
that needs them and revoked in the same batch.

**7702 model.** Position owner separated from batch receiver, an
`outputPositions` channel on step and recipe output, position rediscovery from
logs with no local state, and an executor-residue assertion that fails a batch
leaving anything behind.

**Bundler3 envelope** restores the atomicity 7702 strips.

**A `SwapProvider` seam** behind the swap step — the step was already
provider-agnostic; only two display strings and one name-match coupled it to 0x.

---

## Fixes

**The f(x) write path was wrong on all four pools** (`1242b01`). A full close
reverted `ErrorWithdrawExceedSupply()` on both longs and `Panic(0x11)` on
`WBTC-Short`: `_operate`'s partial branch converts an amount back to shares
rounding **up**, overshooting the position by one share whenever the index is not
the identity. Fixed with f(x)'s `type(int256).min` sentinel on **both** legs —
collateral-only still panics on `WBTC-Short`.

Do not narrow the sentinel to one side. `WBTC-Short` passed the explicit encoding
on 2026-08-12 and panics on it now against the same position, because the debt
index accrued. Which encoding works is a property of the index at mine time.

**A full repay always reverted** `ErrorDebtRatioTooSmall()`. Since a repay leaves
collateral in place, f(x)'s ratio check bounds it far below the debt — 99.97% on
`wstETH-Long`, **89.16%** on `stETH-Short`. New `getFxRepayCeiling()` /
`fxMinRemainingDebt()` bound it at build time; `computeFxRepay` reports
`boundByMinDebtRatio`. To clear a debt entirely, close the position.

**A successful full close left the position NFT public** (`fc0597f`). f(x) never
burns on close — measured, 0 burns over 200k blocks — but the full-close branch
declared `outputNFTs: []`. A success-path privacy leak, not a failure path.

**Morpho Blue full repay underflowed** `Panic(0x11)` (`20f2ea3`). `owedAssets` is
`toAssetsUp(borrowShares)` and `repay` converts back with `toSharesDown`,
yielding `borrowShares + 1`. De-rated by one unit.

**Uniswap V2 remove-liquidity broke when the fee switch was turned on**
(`c42bde5`). `getRemoveLiquidityData` subtracted the **pool-wide** protocol fee
from the **caller's** LP balance. That understates every withdrawal and goes
negative for anyone holding less LP than the pool's accrued fee — the recipe then
fails to build at all, on `amountAMin` out of uint256 range. `burn()` mints the
fee first and divides by the raised supply, so it is dilution; the add path
already modelled it correctly.

**Approvals are bounded** where the amount is deterministic (`dac9c28`) — 8 of 16
call sites granted `2^256-1`.

**A combo could declare a gas floor below its own worst leg** (`fix(combo-meal)`).
Five of seven shipped combos did. Now `max(config, ...recipes)` at the seam.

---

## Gas floors

All fx and Morpho floors are now **measured** on the 7702 path by bisecting the
wire gas limit against shield completion, not by estimating a passing batch —
`requireSuccess` is hardcoded `false`, so `eth_estimateGas` happily converges on
a limit where the shield sub-call runs out and is swallowed.

`K = cost floor − pre-check overhead`, because the constant becomes
`actionData.minGasLimit`, not a wire figure.

| constant | value | note |
|---|---|---|
| `MIN_GAS_LIMIT_EMPTY` | 1,810,000 | cost 1,880,004 across 4 blocks |
| `MIN_GAS_LIMIT_FXMINT_OPEN` | 2,690,000 | was 3,100,000 — **over** by ~421k |
| `MIN_GAS_LIMIT_FXMINT_ADJUST` | 2,920,000 | raised; see below |
| `MIN_GAS_LIMIT_FXMINT_CLOSE` | 3,000,000 | K now pinned, not bounded |
| `MIN_GAS_LIMIT_ZEROX_FXMINT_OPEN_COMBO` | 3,010,000 | new, own floor |
| `MIN_GAS_LIMIT_MORPHO_BLUE_REPAY` | 1,900,000 | |
| `MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW` | 2,150,000 | |

Three findings worth carrying:

- **The corrections went in opposite directions.** `EMPTY` was ~2,735 too low
  while `FXMINT_OPEN` was ~421,000 too high. Any uniform "raise everything above
  the SDK default" would have made fx open worse.
- **The full close is the dearer branch, not the partial** — 3,109,375 vs
  3,031,250, disjoint brackets. The constants file claimed the reverse.
- **The fx open combo needed its own floor.** Measured 3,121,581. Aggregation
  could not rescue it: the generic combo floor of 2,900,000 already exceeded its
  dearest constituent, so `max(...)` returned 2,900,000 — about 221k short. This
  is the flow that ran out of gas at the shield on mainnet carrying 3,016,590.
  A combo costs more than its parts' declared floors, because the swap leg and
  the extra shield request are in no constituent's number.

Floors drift with merkle tree state — about 1%. `FXMINT_ADJUST`'s August floor of
2,992,187 is a *failing* probe today, which is why it rose to 2,920,000. Each
constant carries its measurement and method in a comment; re-run the bisection
rather than adjusting by feel.

---

## Known limitations

- **A failed f(x) open can strand the position NFT at the executor.** Not
  closable from the cookbook: the shield request list is fixed when the proof is
  built, so it cannot depend on what `operate()` did. Needs `RelayAdapt7702.shield`
  to skip rather than revert on an NFT it cannot approve. Mitigated by
  `preflightFxOpen`, which catches the common causes before the batch is built.
- **Nothing a failed batch leaves behind is lost**, but privacy is. The wallet
  holds the ephemeral key, so residue is sweepable in a follow-up transaction —
  at the cost of permanently associating the unshield with that address.
- **`requireSuccess = false` means CONTINUE, not break.** A reverting sub-call is
  swallowed and the batch still mines. Since relay shield requests sweep
  `balanceOf` with `preimage.value = 0n`, most mid-batch failures return the
  user's value shielded and whole — but check `CallError` rather than assuming a
  mined batch did what you asked.
- **`minGasLimit` cannot protect the shield.** It is an entry check on the whole
  batch, before nonce and signature validation; `multicall` has no per-call gas
  reserve.
- **Bundler3 is exported but not wired into `MorphoTransactRecipe`.**
- The `-fx.2` defect-repro scripts do not run unmodified — they pass `rawDebts`
  into `computeFxClose` and hit `assertNativeDebt`. That is breaking change 1
  working as designed. Update them to native units first.

---

## Verification

Suite 773 passing / 38 pending. Both typechecks clean, no circular dependencies.

The f(x) write path is verified against **live mainnet positions on all four
pools** rather than fixtures, by replaying the recipe's own calldata through
state-overridden `eth_call` — no funds, no keys, nothing signed. Opt in with
`RUN_MAINNET_SIM=1`. A fixture cannot express this defect: it is a share-rounding
boundary, and a fixture with an identity index has no boundary to cross.

Note for anyone reproducing the fork measurements: a **non-archive** RPC serves a
forked anvil for only ~128 blocks before it 403s and the node panics, which caps
a session at roughly 25 minutes. Use an archive endpoint.
