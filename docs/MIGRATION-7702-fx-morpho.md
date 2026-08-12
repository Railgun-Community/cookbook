# Migration — f(x) and Morpho, 7702 release

Branch `zy0n/7702-morpho-addons`, off `2.12.4`.

This release carries **two breaking changes**. They are unrelated in mechanism and
land in different modules, but migrate them **together**: each one, taken alone,
leaves a call site that compiles and produces wrong on-chain behaviour rather than
an error. Migrating one and discovering the other later is the failure this note
exists to prevent.

Everything else here is additive or a behaviour fix that needs no code change —
but two of the behaviour fixes change what goes on chain, so read §3 before
shipping even if §1 and §2 do not apply to you.

---

## 1. BREAKING — f(x) close and repay take native units

`computeFxClose` and `computeFxRepay` compared a **raw** debt figure against
**native** amounts. Long pools report debt native and collateral raw; the short
pools report the reverse. On `WBTC-Short`, where raw = native × 10^10, a caller
passing `position.rawDebts` got three simultaneous failures:

| | consequence |
|---|---|
| `repayAmount` | 872,500 sats **more** than the debt — `operate()` underflows the position and reverts |
| `withdrawColl` | 1.017e-8 % of the position released instead of the pro-rata share |
| `partialClose` | stuck `true`, so a full close was treated as partial and the amounts above were computed against the wrong branch |

### What changed

`FxCloseInputs` — three renames and one field promoted from optional to required:

```diff
 export type FxCloseInputs = {
-  collateral: bigint;          // was accepted as rawColls
+  collateral: bigint;          // native; getFxPosition().collateralAmount
-  debt: bigint;                // was rawDebts
+  debt: bigint;                // native; getFxPosition().debt
-  shieldedFxUSD: bigint;
+  availableDebtToken: bigint;
   repayFeeRatio: bigint;
-  withdrawFeeRatio?: bigint;   // defaulted to 0n
+  withdrawFeeRatio: bigint;    // REQUIRED
   railgunUnshieldFeeBps: bigint;
 };
```

### What you must do

1. **Read from `getFxPosition()`, not from the raw accessors.** Pass
   `.collateralAmount` and `.debt`. `rawColls`/`rawDebts` are no longer
   expressible at this boundary at all — the reader converts once, and this takes
   its output.
2. **Rename `shieldedFxUSD` → `availableDebtToken`, and check you are passing the
   right token.** This is not cosmetic. A close repays the **debt** token: fxUSD
   on a long, but **wstETH or WBTC on a short**, where fxUSD is the *collateral*.
   The old name asserted fxUSD unconditionally and was wrong on every short.
3. **Pass `withdrawFeeRatio` explicitly**, from
   `getFxPool(...).withdrawFeeRatio`. It is `0n` on the long pools and
   `1_000_000n` (0.1 %) on the shorts. Pass `0n` for a long rather than omitting.

The old default of `0n` was correct for one side and silently wrong for the other,
and the resulting over-declaration is **not caught by the step validator** —
that only reconciles tokens present in the step's *input*, and collateral is an
output. `FxMintClosePositionStep` now throws at construction if the field is
missing, so plain-JS callers get a named error instead of a `TypeError` raised
two modules away.

A guard also rejects a raw figure passed where a native one belongs, but do not
rely on it: on the long pools raw and native are equal, so it cannot distinguish
them there.

---

## 2. BREAKING — Morpho Blue builders take `owner` and `receiver`

The premise of this release is that a reusable 7702 account makes **the account
the position handle**. That requires distinguishing:

- **`owner`** (`onBehalf` on chain) — the durable account that **holds** the
  position, across batches
- **`receiver`** — whatever account **this** batch runs as and shields from

The quote builders collapsed both into a single `recipient`, documented as
deliberate: *"Positions are un-tokenized: onBehalf == receiver == the ephemeral
EOA."* True only while every position is opened and closed by the same
single-use account. It is the assumption this release exists to remove.

### What you must do

Replace `recipient` with `owner` (and `receiver` where the builder takes one) on:

```
getRepayQuote            getBorrowQuote
getRepaySharesQuote      getWithdrawCollateralQuote
getSupplyCollateralQuote getWithdrawAllCollateralQuote
```

If you are not yet separating the two, pass **the same address to both** — that
reproduces today's behaviour exactly.

### The part that is not a rename

Splitting the signature alone would have been **unsafe**, and this is the reason
the change is not a codemod:

- **Two builders READ position state keyed on the account.**
  `getRepaySharesQuote` reads `position(id, onBehalf).borrowShares`;
  `getWithdrawAllCollateralQuote` reads `position(id, executor).collateral`. Left
  keyed on the wrong one of the two, they quote against the executor's own
  position — which is empty — and produce a zero-amount batch that mines
  successfully. Silent, not an error.
- **Acting on someone else's behalf requires on-chain authorization.**
  `MorphoBlueAPI.assertAuthorized` now runs in every affected builder and throws
  a named error naming the operation, rather than letting the batch reach chain
  and revert inside Blue's `_isSenderAuthorized`.

If your integration always uses one account for both roles, neither applies —
but pass both explicitly anyway, so the day you separate them the guards are
already in the path.

---

## 3. Behaviour changes needing no code change

These alter what reaches chain. Verify against them even if §1 and §2 do not
apply.

### 3.1 ERC-20 approvals are now bounded

Eight of sixteen `ApproveERC20SpenderStep` call sites passed no amount, and the
step fell through to `2^256-1`. Every combo routing through 0x granted a
third-party aggregator an **unlimited, non-decaying** allowance from an account
that, under 7702, is single-use and unmonitored afterwards.

Approvals are now bounded to the exact figure whenever the input is deterministic
(`minBalance === expectedBalance` — true whenever the token comes straight from an
unshield). Unlimited survives only where the runtime balance genuinely is not
knowable in advance, because a downstream that pulls the whole balance (Beefy
`depositAll`) would fail against a short approval if the fill beats the quote.

Declared recipe accounting does **not** move — the output was already
`min(approveAmount, expectedBalance)`. But if your tests assert on encoded
calldata, those fixtures will need updating. Build the expected calldata from the
amount rather than pinning a hex literal: a 64-character run of `f` reads like
any other calldata tail, which is exactly how this shipped unnoticed.

### 3.2 A full f(x) close now shields the position NFT back

f(x) does **not** burn a position NFT on close. `FxMintClosePositionStep`
assumed it did, so the full-close branch declared `outputNFTs: []` and left the
bearer handle public at the ephemeral account on **every successful full close**.
It is now declared unconditionally.

If you keyed anything on "a full close consumes the NFT" — a UI that removes the
position on seeing `spentNFTs`, or a reader that treats a surviving NFT as a
failed close — invert it. A closed position is a live NFT reading `(0, 0)`; the
`outputPositions` records, not the NFT, are what describe the retirement.

### 3.3 A full f(x) close encodes f(x)'s sentinel, not the computed amounts

`FxMintClosePositionStep` now passes `type(int256).min` on **both** legs of
`operate()` when `partialClose === false`. A partial close is unchanged.

You need no code change, but you should know why, because it moves where a
close can fail. f(x) stores a position in shares and `_operate` converts an
explicit amount back rounding **up**, so a figure read from `getPosition()`
overshoots the position by one share whenever the index is not the identity.
Measured at head against live positions:

| pool | explicit amounts | sentinel |
| --- | --- | --- |
| `wstETH-Long` #1983 | `ErrorWithdrawExceedSupply()` | ok |
| `WBTC-Long` #901 | `ErrorWithdrawExceedSupply()` | ok |
| `stETH-Short` #167 | ok | ok |
| `WBTC-Short` #94 | `Panic(0x11)` | ok |

`WBTC-Short` is the one to hold on to: it passed the explicit encoding on
2026-08-12 and panics on it now, against the *same* position. Whether an
explicit amount lands is a property of the collateral and debt indices at mine
time, not of the pool or the side. So this is unconditional, and narrowing it
to "longs only" on the strength of a green run would regress.

**One consequence for amount accounting.** On a full close the pool now decides
the withdrawal, from `positionColl` and the index at mine time, so the step's
declared collateral output is an estimate rather than a guarantee. It is still
declared deterministic (`min == expected`) on purpose — widening it would fail
the non-deterministic-input gate and take the swap-back combos with it. A
surplus reshields, because relay shields sweep `balanceOf`; a shortfall fails
the downstream swap's `transferFrom` and, under continue-semantics, still
reaches the shield and returns the collateral whole.

### 3.4 A full f(x) repay is not expressible, and never was

`FxMintRepayDebtRecipe` leaves the collateral in place, so f(x)'s final check —
`rawDebts x P x P < minDebtRatio x rawColls x price` — bounds how far the debt
can fall. A repay that clears the whole debt reverts `ErrorDebtRatioTooSmall()`
on every pool. This is not new behaviour; it is newly *visible*, and previously
such a batch mined with the repay swallowed by `requireSuccess = false`.

The headroom is not a rounding detail. Measured at head:

| pool | `minDebtRatio` | largest accepted repay |
| --- | --- | --- |
| `wstETH-Long` | 0.0001e18 | 99.97% of debt |
| `stETH-Short` | 0.0909e18 | **89.16%** of debt |

A 99% repay is fine on a long and reverts on a short.

**What to do.** Read `getFxRepayCeiling(positionId, pool, provider)` and pass
its `minRemainingDebt` into `computeFxRepay` (and into `quoteFxSwapRepay`,
which now accepts it). `computeFxRepay` then caps the repay and sets
`boundByMinDebtRatio` so you can tell "the protocol refused" from "you could
not afford more" — different messages, different next actions. It throws when
the floor is at or above the whole debt, rather than building a batch that
cannot succeed.

To clear a debt **completely**, close the position instead. A close takes both
legs to zero in the same call, so the ratio check reads `0 < minDebtRatio x 0 x
price` and does not bind.

### 3.5 `getFxDebtScalingFactor` no longer throws on a long pool

It threw on both long pools, because a long owes fxUSD and the manager holds no
`tokenRates` entry for a token that is not rate-bearing. It now returns
`FX_SCALE_PRECISION`, the identity — which is what scaling a natively
denominated figure means, and what `getFxPosition` already relied on.

A **short** with no entry still throws. There the debt is the rate-bearing
asset, and reading a missing entry as identity would understate a `WBTC-Short`
debt by 10^10 silently, in the direction that under-repays.

If you wrapped this call in a try/catch to work around the long-side throw, the
catch is now dead on that path.

### 3.6 A combo's gas floor is now its dearest constituent recipe

Five of seven shipped combos declared a floor *below* their own worst leg, all
taking the generic `MIN_GAS_LIMIT_COMBO_MEAL` while wrapping recipes sized
higher. The floor is enforced in-contract as a `gasleft()` require. A combo's own
config still wins when it is the larger number; this can only raise a floor,
never lower one.

### 3.7 Two gas-floor constants moved, from measurement

| constant | was | now |
|---|---|---|
| `MIN_GAS_LIMIT_EMPTY` | 1,800,000 | **1,810,000** |
| `MIN_GAS_LIMIT_FXMINT_OPEN` | 3,100,000 | **2,690,000** |

Measured on a mainnet fork against a **shield-completion oracle** — necessarily,
because both 7702 paths hardcode `requireSuccess = false`, so a batch that mines
with `status 1` proves nothing about whether the shield ran. `ADJUST` and `CLOSE`
were measured and found already correct.

`MIN_GAS_LIMIT_*` is now exported from the root barrel; if you were reaching into
the module path, take the barrel export.

**Do not** "fix" the wallet SDK's raw-vs-minus-150,000 asymmetry without reading
the analysis first: the 7702 path never sets wire = m, and subtracting would make
the guard inert on the one path where `eth_estimateGas` is known unreliable.
These constants are calibrated for raw semantics.

---

## 4. What a failed batch does now — read this before shipping

Both 7702 paths hardcode `requireSuccess = false`. **This means CONTINUE, not
break** — `_multicall` emits `CallError(i, data)` and proceeds to call `i+1`.
Two consequences that are easy to get backwards:

- **A failing inner call cannot produce `status 0`.** The batch mines
  successfully with the value somewhere unexpected. Do not treat receipt status
  as a success signal for a 7702 batch.
- **The trailing shield still runs.** Because relay shield requests are built
  with `value = 0n` and sweep `balanceOf`, **most** mid-batch failures return the
  user's value shielded and whole. "The value strands at the executor" is a
  per-step property, not a property of the mechanism.

`src/steps/failure-modes.ts` states the outcome for all 27 steps.

**Nothing is lost.** The wallet holds the ephemeral key, so anything left on the
executor — ERC-20 dust, a position NFT, native balance — can be swept in a
follow-up transaction. What a failed batch costs is **privacy**: the unshield
becomes publicly and permanently associated with that address, and someone has to
notice and send the recovery. Two of the three cases below are now fixed
outright; the third is narrowed and named.

- **`FxMintClosePositionStep` — FIXED.** f(x) does not burn a position NFT on
  close (measured: 1,097 transfers, 33 mints, zero burns over 200,000 blocks; 19
  of 51 sampled positions read `(0, 0)` with `ownerOf` still live). The full-close
  branch assumed it did, declared `outputNFTs: []`, and so left the handle public
  on **every successful full close**, not only on failure. The NFT is now declared
  unconditionally, which fixes the success path and removes the stranding case
  together.
- **`MorphoBlueSetAuthorizationStep` — FIXED, and it was the only one that
  mattered structurally.** A standing grant is not value, so no sweep reaches it
  and holding the ephemeral key does not help; only an explicit revoke removes it.
  Wrap the grant in `withScopedMorphoBlueAuthorization` when it is a means to
  something else in the same batch — the trailing revoke still runs when the
  wrapped steps fail, precisely because continue-semantics do not skip it. Use the
  bare step only when the grant is meant to outlive the batch.
- **`FxMintOpenPositionStep` — a privacy cost, not a loss.** It declares
  `predictedPositionId` in `outputNFTs` unconditionally, so a failed `operate()`
  leaves an ERC-721 shield request for a token never minted; `RelayAdapt7702.shield`
  approves every NFT request **before any ERC-20 work**, that reverts, and the
  whole shield goes with it. Same shape when the predicted id races.
  The collateral is then public at the ephemeral account — and recoverable, since
  the wallet holds that key. Budget for a follow-up sweep and a permanent link
  between the unshield and that address; nothing is stranded and nothing is lost.
  It cannot be removed from the cookbook side (the shield request list is fixed
  when the proof is built, so it cannot depend on what `operate()` did); a
  relay-adapt change that skipped an unapprovable NFT request would remove it, but
  nothing waits on that. Meanwhile run
  `preflightFxOpen` immediately before building and pass its id straight through
  — it reports the gate, the pool's debt capacity and a stale id, and names what
  it does not check (`resulting-debt-ratio`, `operate-simulation`,
  `same-block-guarantee`).

`minGasLimit` does not help with any of this. It appears only in `execute`, as
its first statement, ahead of nonce and signature validation; `multicall` has no
gas check and there is no per-call reserve. It is an entry check on the whole
batch and **cannot protect the shield epilogue specifically**.

---

## 5. New, additive — nothing breaks if you ignore it

| capability | entry point |
|---|---|
| Position records emitted per step | `RecipeOutput.outputPositions` |
| Rediscover Blue positions from logs, with no local state | `rediscoverMorphoBluePositions` |
| Rediscover f(x) bearer positions | `rediscoverFxPositions` |
| Rediscover delegated authority grants | `scanMorphoBlueAuthorizations` |
| Blue health / liquidation risk | `MorphoBlueAPI.getPositionRisks` |
| Assert the executor was left empty | `assertExecutorResidue` |
| Refuse a gated Morpho vault before it strands shares | in the three `get*Quote` builders |
| Scope a Blue authorization to one batch | `withScopedMorphoBlueAuthorization` |
| Preflight an f(x) open before building it | `preflightFxOpen` / `assertFxOpenViable` |
| Preflight f(x)'s `onlyTopLevelCall` whitelist | in the f(x) API |
| Shield-args adapter (previously duplicated in two test files) | root barrel |
| Close an f(x) position holding none of the debt token | `ZeroXSwap_FxMintClose_ComboMeal` + `quoteFxSwapClose` |
| Repay f(x) debt holding none of the debt token | `ZeroXSwap_FxMintRepay_ComboMeal` + `quoteFxSwapRepay` |
| Lend into a Blue market, and exit a lend position | `MorphoBlueSupplyLoanRecipe` / `MorphoBlueWithdrawLoanRecipe` |
| Enumerate Blue markets with no prior knowledge of an id | `scanMorphoBlueMarkets` + `filterMorphoBlueMarkets` |
| The largest f(x) repay a position can actually take | `getFxRepayCeiling` |
| The debt a position must retain, as pure math | `fxMinRemainingDebt` |
| Replay a full close against mainnet, no funds, no keys | `RUN_MAINNET_SIM=1 npm test` |

Four of these are worth adopting deliberately rather than eventually:

**Rediscovery is load-bearing for f(x), not a convenience.** f(x) pools are not
`ERC721Enumerable`, so `balanceOf` says you hold three positions and nothing on
chain says *which*. Logs are the only enumeration path. Note also that
`getFxPosition` returns `(0,0)` for a nonexistent id rather than reverting, f(x)
does **not** burn on close (a closed position is a live NFT holding nothing), and
a correctly shielded position looks like absence to a "tokens you hold" reader —
the relay adapter owns it. `custodyStatus` classifies rather than filters.

**Size a swap-then-close or swap-then-repay against the GUARANTEED fill.** 0x V2
quotes here are sell-amount only — `BaseAPIParamsV2` has no `buyAmount` — so no
quote can promise an exact output, while `operate()` is built with an exact
`repayAmount`. Sizing against the expected fill leaves the close short whenever
the fill is merely average, which is most of the time. `quoteFxSwapClose` and
`quoteFxSwapRepay` exist so you do not have to get this right by hand; both pass
`railgunUnshieldFeeBps: 0n` deliberately, because the unshield fee was already
charged on the *sell* token and the debt token never passes through an unshield.
An oversized build fails at build time rather than mining a no-op.

**On the Blue lend side, free liquidity — not health — is what refuses a
withdrawal.** Lent assets are out on loan, so Blue reverts
`InsufficientLiquidity` when `totalSupplyAssets - totalBorrowAssets` falls below
the withdrawal, and a fully utilized market locks lenders out however healthy
their position. Collateral has no equivalent constraint. Two consequences worth
carrying into a UI: a full exit must be denominated in **shares**, since interest
accrues between building and inclusion and an assets-denominated "withdraw
everything" leaves a residue; and market discovery flags **idle** markets, of
which mainnet has 51 fully idle and 73 with a zero IRM — a zero-IRM market
accrues nothing, so a lender routed there earns zero forever while the market
looks entirely normal.

**Gated vaults have four gates, not two.** Vaults V2 checks
`canReceiveShares`/`canSendAssets` on enter, `canSendShares`/`canReceiveAssets`
on exit, and `canSendShares`/`canReceiveShares` on transfer. The **share** gates
are the dangerous ones: a deposit mints shares to the executor, and the shield
leg is `transferFrom(executor → RAILGUN proxy)`, gate-checked on **both**
endpoints. The proxy is a fixed third party no curator allowlist will contain, so
**any share gate makes a vault unusable through RAILGUN even when the executor is
allowlisted** — the deposit succeeds and the shares are then unshieldable.
Neither shipped vault is gated today.

---

## 6. Scope

fx and Morpho only. The P3 protocol expansion — Aave v3, Compound v3, Sky/sUSDS,
Pendle, Uniswap v3/v4, Curve/Convex, Lido, EigenLayer — is deferred to a separate
branch cut after this one ships. The `owner`/`receiver` split, `outputPositions`
and rediscovery are the groundwork those need, so the deferral costs nothing.

## 7. Known gaps

Nothing here blocks a user action outright. The two that did are closed:
f(x) could not be closed or repaid without already holding the debt token, and
the Blue lend side was unreachable.

- **The fx-open combo floor is unmeasured.** It mines with a swallowed
  `CallError` and fails identically at 60M gas, so it is not a gas problem —
  suspected to be a 0x quote fetched at mainnet head and executed against a
  pinned fork.
- **A failed f(x) open leaves the collateral public at the ephemeral account**,
  because the epilogue's NFT approve reverts and takes the whole shield with it.
  This is a privacy and convenience cost, NOT a loss and NOT a blocker: the
  wallet holds the ephemeral key, so the collateral is swept in a follow-up
  transaction. What is spent is the linkage between the unshield and that
  address, one extra transaction, and the gas. `preflightFxOpen` makes it rarer;
  a relay-adapt change that skipped an unapprovable NFT request instead of
  reverting would remove it entirely, but nothing waits on that.
- **`preflightFxOpen` does not check the resulting debt ratio.** That needs a
  collateral price, and f(x) exposes the ratio only for a position that already
  exists. An open landing above the rebalance threshold still passes preflight.
- **Market discovery cannot be server-filtered.** `CreateMarket` indexes only
  `id`, so finding "every USDC market" means fetching all ~1,700 logs and
  filtering locally. Cache the scan; markets are append-only, so a later pass
  need only cover `[lastToBlock + 1, head]`. Note many public RPC endpoints
  refuse `eth_getLogs` outright.
