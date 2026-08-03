# f(x) Protocol — fxMINT recipes

Cookbook recipes for opening, closing, and managing [f(x) Protocol](https://fx.aladdin.club)
debt positions privately, through a Railgun cross-contract call executed by an
EIP-7702 ephemeral EOA.

The recipes plug into any wallet that already consumes
`@railgun-community/cookbook` — adoption is the same shape as for any other
recipe (`new FxMintOpenRecipe(...).getRecipeOutput(input)`).

## What this is for

f(x) Protocol lets a user mint fxUSD against tier one collaterals
(wstETH, WBTC) without recurring costs (one time fee) and with a unique
liquidation design that prevents any hard liquidation.

Every position is wrapped into an NFT while the collateral is pooled at protocol
level to make progressive liquidations possible. It unlocks the possibility of
borrowing privately through Railgun while having a liquidatable debt position.

These recipes wrap that flow as a Railgun cross-contract call so a user can:

- **Open** a debt position: deposit shielded collateral, borrow the pool's debt
  token; shield the borrowed token and the position NFT back to the user's
  `0zk` address.
- **Close** (or partially close): unshield the debt token, repay debt against
  the position, withdraw collateral; reshield the proceeds and (for partial
  close) the surviving NFT.
- **Top up collateral**: add collateral to an existing position without changing
  debt. The position's debt ratio falls — risk-management dial.
- **Top up + borrow more**: add collateral AND mint additional fxUSD in one
  atomic `operate()`. Increases exposure (lever-up).
- **Borrow more**: mint additional fxUSD against an existing position without
  adding collateral. Raises the debt ratio — caller should sanity-check against
  the pool's liquidation threshold first.
- **Repay debt**: burn fxUSD to reduce an existing position's debt without
  withdrawing collateral. Symmetric counterpart to top-up — the other
  risk-management dial.

What's hidden: the link between the user's wallet and the on-chain f(x)
position. What's still public: the position's collateral, debt, and health on
f(x); the on-chain owner-of-record (the ephemeral EOA the batch executed as);
the fact that a Railgun cross-contract call interacted with f(x). f(x)'s
liquidation flow operates against the public position state regardless of who
deposited.

## Long and short pools

Every recipe, combo and reader here works on **both** sides of the protocol. The
pool descriptor carries which side it is on, and the amount math needs no branch
on it — see [Which side is which](#which-side-is-which) for why.

| Pool name | Side | Collateral | Debt | Manager |
| --- | --- | --- | --- | --- |
| `wstETH-Long` | long | wstETH (18) | fxUSD (18) | `0x250893CA…928FCD24` |
| `WBTC-Long` | long | WBTC (**8**) | fxUSD (18) | `0x250893CA…928FCD24` |
| `stETH-Short` | short | fxUSD (18) | wstETH (18) | `0xaCDc0AB5…1FDd66D` |
| `WBTC-Short` | short | fxUSD (18) | WBTC (**8**) | `0xaCDc0AB5…1FDd66D` |

A long deposits the volatile asset and mints fxUSD. A short is the mirror:
deposit fxUSD, borrow the volatile asset (f(x) calls these *sPOSITION*, up to 6x
short). Short pools are f(x) v2.1 and are registered on a **different
PoolManager** — which is why the manager is carried per-pool rather than as a
module constant. `operate()` has the same 4-arg signature on both.

### Which side is which

Three things flip, and it is worth internalising all three before writing
against this:

1. **The tokens swap roles.** `pool.collateralToken` and `pool.debtToken` are
   the only correct way to refer to them. On `WBTC-Short` the 8-decimal token is
   the *debt*; on `WBTC-Long` it is the *collateral*.
2. **The fees swap sides.** Longs charge on the debt axis (0.5% borrow, 0.2%
   repay) and nothing on collateral. Shorts charge on the collateral axis (0.3%
   supply, 0.1% withdraw) and nothing on debt. Because each side's unused ratios
   are zero, one set of formulas covers both.
3. **The raw-scaled side flips.** A long pool reports collateral raw and debt
   native; a short reports collateral native and **debt raw** (18dp-normalised).
   `getFxPosition` converts for you — use `position.debt`, never `rawDebts`,
   unless you are reconstructing f(x)-internal math. On `WBTC-Short` the two
   differ by a factor of 10^10.

### Fee semantics, precisely

Read off the verified `ShortPoolManager.sol`. The two collateral-side fees are
**not** symmetric, which is the easiest thing to get wrong:

| Operation | What the caller parts with | What the caller receives |
| --- | --- | --- |
| supply (collDelta > 0) | the **full** amount | — |
| withdraw (collDelta < 0) | — | amount **− withdraw fee** |
| borrow (debtDelta > 0) | — | amount **− borrow fee** |
| repay (debtDelta < 0) | amount **+ repay fee** | — |

The supply fee does **not** reduce the caller's outlay — the manager pulls the
full amount and keeps the fee out of what it credits to the *position*. So it
affects position health, not step accounting. The repay fee is charged **on top
of** the principal (two separate `transferFrom` calls), so an approval sized to
the principal alone reverts. Helpers: `fxCollateralSupplySpend`,
`fxCollateralWithdrawOutput`, `fxDebtBorrowOutput`, `fxDebtRepaySpend`.

### Using a short pool

```ts
import {
  FxMintOpenRecipe,
  FxMintCloseRecipe,
  getFxPool,
  getFxPosition,
  getNextFxPositionId,
} from '@railgun-community/cookbook';

const pool = await getFxPool('stETH-Short', provider);

const open = new FxMintOpenRecipe({
  pool: 'stETH-Short',
  targetDebt: 1_000_000_000_000_000_000n, // 1 wstETH borrowed
  predictedPositionId: await getNextFxPositionId('stETH-Short', provider),
  borrowFeeRatio: pool.borrowFeeRatio, // 0 on shorts today — read it, don't assume
});
// input.erc20Amounts must contain fxUSD (the short's collateral).

// Closing a short REQUIRES withdrawFeeRatio, or the reshielded collateral is
// over-declared by 0.1% and the recipe's amount accounting fails.
const close = new FxMintCloseRecipe({
  pool: 'stETH-Short',
  positionId,
  repayAmount,      // native wstETH — from position.debt, NOT position.rawDebts
  approveAmount,
  withdrawColl,
  withdrawFeeRatio: pool.withdrawFeeRatio,
  partialClose: true,
});
```

`creditNote` — a per-pool ERC20 redeemable for collateral via
`ShortPoolManager.redeemByCreditNote` — is **not** covered. It is a separate
entry point, off the open/topup/borrow/repay/close path.

## Recipes are single-protocol; combos handle the swap

Every recipe here takes the **pool's collateral token** directly (or fxUSD on
the debt axis). There is no swap leg inside a recipe and no `swapQuote`
parameter — see [Migration](#migration-breaking) if you are coming from v0.1.

To enter or exit from any other asset, use a **ComboMeal** from
`src/combo-meals/fx`. The combo puts a self-quoting `ZeroXV2SwapRecipe` on the
correct side of the fx recipe and fetches the 0x quote itself, against the real
post-unshield balance. The caller never fetches a quote.

| You have | You want | Use |
| --- | --- | --- |
| pool collateral | open / topup / lever up | the recipe directly |
| any other ERC-20 | open | `ZeroXSwap_FxMintOpen_ComboMeal` |
| any other ERC-20 | topup | `ZeroXSwap_FxMintTopup_ComboMeal` |
| any other ERC-20 | lever up | `ZeroXSwap_FxMintTopupAndBorrow_ComboMeal` |
| a position | exit into any ERC-20 | `FxMintClose_ZeroXSwap_ComboMeal` |

The combo derives the swap's other side from the pool via `resolvePool()`, so a
quote can never name a token that disagrees with the collateral the position
actually needs. Passing a sell token that already *is* the pool collateral
throws — use the recipe directly.

> **The fx combos are not yet verified end-to-end on-chain.** The fork harness
> executes through the relay-adapt contract, which `resolveExecutorAddress`
> rejects by design, so a 7702 combo cannot run there. Combos are covered by
> unit tests with stubbed 0x quotes (`src/combo-meals/fx/__tests__`). A 7702
> `execute()` fork harness is tracked as follow-up work.

## Pool support

Two mainnet pools are wired up by name. For new pools, pass an explicit
`{ address, collateralToken, collateralDecimals }` object as the `pool` arg.

| Name          | Pool address                                 | Collateral                  | Decimals |
| ------------- | -------------------------------------------- | --------------------------- | -------- |
| `wstETH-Long` | `0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8` | wstETH (`0x7f39C581…E2Ca0`) | 18       |
| `WBTC-Long`   | `0xAB709e26Fa6B0A30c119D8c55B887DeD24952473` | WBTC (`0x2260FAC5…2C599`)   | 8        |

All pools now take the same step graph — there is no per-pool swap/direct
branch. Custom pool refs work identically.

f(x) shorts (fxBASE-side products) and the fxSAVE yield product are out of scope
of these recipes.

## On-chain parameters — fetch dynamically

f(x) governance can rotate the per-pool borrow fee, repay fee, and liquidation
threshold via `PoolConfiguration` and `Pool` admin functions. Recipes that touch
these parameters take them as constructor args; the caller is expected to fetch
live values via `getFxPool` (see [Read API](#read-api)) rather than hardcoding.
None of these recipes embed fee or threshold constants.

## Position NFT `tokenSubID` contract

The steps derive the position NFT's `tokenSubID` as
`'0x' + positionId.toString(16)` — hex, lowercase, **unpadded**.

You may pass the 32-byte zero-padded form instead; identity comparison across
the recipe engine, the step validator, and the combo seam runs through
`nftIdentityKey()`, which normalizes both padding and address checksum casing.
Non-numeric `tokenSubID` values fall back to exact (lowercased) string match.

## Usage — open a position

```ts
import {
  FxMintOpenRecipe,
  getFxPool,
} from '@railgun-community/cookbook';
import { NetworkName } from '@railgun-community/shared-models';

// Fetch live borrow fee + other pool state (single helper, see Read API):
const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintOpenRecipe({
  pool: 'wstETH-Long',                       // or 'WBTC-Long', or a custom ref
  targetDebt: 5_000_000_000_000_000_000n,    // 5 fxUSD
  predictedPositionId: 1903n,                // Pool.getNextPositionId()
  borrowFeeRatio: pool.borrowFeeRatio,       // 1e9-denom, governance-upgradable
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,                            // user's 0zk address
  erc20Amounts: [
    // The POOL COLLATERAL, not WETH. See the combo below to enter from
    // anything else.
    { tokenAddress: pool.collateralToken, amount: 8_000_000_000_000_000n },
  ],
  nfts: [],
});

// Feed `recipeOutput.crossContractCalls` / `.erc20AmountRecipients` /
// `.nftAmountRecipients` to the standard Railgun proof+populate+broadcast
// pipeline.
```

## Usage — open from any token (ComboMeal)

```ts
import { ZeroXSwap_FxMintOpen_ComboMeal } from '@railgun-community/cookbook';

const combo = new ZeroXSwap_FxMintOpen_ComboMeal({
  pool: 'wstETH-Long',
  targetDebt: 5_000_000_000_000_000_000n,
  predictedPositionId: 1903n,
  borrowFeeRatio: pool.borrowFeeRatio,

  sellERC20Info: { tokenAddress: USDC, decimals: 6n, isBaseToken: false },
  swapSlippageBasisPoints: 100,
  recipient: ephemeralExecutor,              // EphemeralExecutor | address
});

const comboOutput = await combo.getComboMealOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{ tokenAddress: USDC, amount: 1_000_000n }],
  nfts: [],
});
```

`recipient` is the EIP-7702 ephemeral EOA the batch executes as. It is validated
once (a relay-adapt address is rejected) and threaded into the 0x quote as the
`taker`. The fx recipe itself takes no executor: `PoolManager.operate()` sends
the borrowed debt token and the position NFT to `msg.sender`, which *is* the
executing account.

**Underfill behavior.** The swap's buy amount is a range
(`[minimumBuyAmount, buyERC20Amount.amount]`) while `operate()` pulls an exact
amount. The combo runs its seam in conservative mode and the fx step encodes the
guaranteed minimum, so a fill below quote deposits slightly less collateral at
an unchanged `targetDebt` — a marginally higher debt ratio, bounded by your
slippage — instead of reverting the batch. Any surplus reshields.

## Usage — close a position

```ts
import {
  FxMintCloseRecipe,
  computeFxClose,
  getFxPool,
  getFxPosition,
  FX_ADDRESSES,
} from '@railgun-community/cookbook';
import { NFTTokenType } from '@railgun-community/shared-models';

const pool = await getFxPool('wstETH-Long', provider);
const position = await getFxPosition(positionId, 'wstETH-Long', provider);

// Pre-compute the operate amounts: the pro-rata collateral release, f(x)'s
// repay and withdraw fees, and Railgun's 25 bps unshield fee.
//
// Both amount fields are NATIVE token units and come straight off the position
// reader, which has already done the raw→native conversion for whichever axis
// this pool reports raw. Never pass `position.rawColls` / `position.rawDebts`
// here — see "Raw vs native" above.
const amounts = computeFxClose({
  collateral: position.collateralAmount,
  debt: position.debt,
  availableDebtToken,                     // balance of pool.debtToken — fxUSD on
                                          // a long, wstETH/WBTC on a short
  repayFeeRatio: pool.repayFeeRatio,
  withdrawFeeRatio: pool.withdrawFeeRatio, // 0n on longs, 0.1% on shorts
  railgunUnshieldFeeBps: 25n,
});

const recipe = new FxMintCloseRecipe({
  pool: 'wstETH-Long',
  positionId,
  ...amounts,                             // { repayAmount, withdrawColl,
                                          //   withdrawCollNet, withdrawFeeRatio,
                                          //   approveAmount, partialClose }
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  // The DEBT token, off the pool descriptor. On a short this is wstETH/WBTC —
  // fxUSD is that pool's *collateral*, so hardcoding it here sends the wrong
  // token entirely.
  erc20Amounts: [{ tokenAddress: pool.debtToken, amount: availableDebtToken }],
  nfts: [{
    nftAddress: pool.address,             // per-pool NFT contract
    tokenSubID: '0x' + positionId.toString(16),
    nftTokenType: NFTTokenType.ERC721,
    amount: 1n,
  }],
});
```

Outputs: the **pool collateral** (not WETH), any unspent fxUSD, and — on a
partial close — the position NFT.

To exit into a different asset, wrap it:

```ts
import { FxMintClose_ZeroXSwap_ComboMeal } from '@railgun-community/cookbook';

const combo = new FxMintClose_ZeroXSwap_ComboMeal({
  pool: 'wstETH-Long',
  positionId,
  ...amounts,
  buyERC20Info: { tokenAddress: USDC, decimals: 6n, isBaseToken: false },
  swapSlippageBasisPoints: 100,
  recipient: ephemeralExecutor,
});
```

## Usage — top up collateral

```ts
import { FxMintTopupRecipe } from '@railgun-community/cookbook';

const recipe = new FxMintTopupRecipe({
  pool: 'wstETH-Long',
  positionId: 1903n,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{
    tokenAddress: pool.collateralToken,
    amount: 2_000_000_000_000_000n,
  }],
  nfts: [{
    nftAddress: poolAddress,
    tokenSubID: '0x' + positionId.toString(16),
    nftTokenType: NFTTokenType.ERC721,
    amount: 1n,
  }],
});
```

Inputs: the pool collateral plus the position NFT. Outputs (shielded back): the
same position NFT (top-up preserves the identifier; only full close burns it).
No fxUSD output — debt is unchanged.

From any other token, use `ZeroXSwap_FxMintTopup_ComboMeal` with the same
`sellERC20Info` / `swapSlippageBasisPoints` / `recipient` fields as the open
combo. **The position NFT goes in the combo's input `nfts`** — it transits the
swap leg untouched and shields back to the user.

## Usage — top up and borrow more

```ts
import {
  FxMintTopupAndBorrowRecipe,
  ZeroXSwap_FxMintTopupAndBorrow_ComboMeal,
  getFxPool,
} from '@railgun-community/cookbook';

const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintTopupAndBorrowRecipe({
  pool: 'wstETH-Long',
  positionId: 1903n,
  additionalDebt: 1_000_000_000_000_000_000n,   // mint +1 fxUSD
  borrowFeeRatio: pool.borrowFeeRatio,
});
// erc20Amounts: pool collateral; nfts: the position NFT.
```

Combines a collateral top-up with a fxUSD mint in a single atomic
`PoolManager.operate(positionId, +coll, +debt)`. Outputs: position NFT +
post-borrow-fee net fxUSD. From any other token, use
`ZeroXSwap_FxMintTopupAndBorrow_ComboMeal`.

## Usage — borrow more

```ts
import { FxMintBorrowMoreRecipe, getFxPool } from '@railgun-community/cookbook';

const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintBorrowMoreRecipe({
  pool: 'wstETH-Long',                               // pool-agnostic
  positionId: 1903n,
  additionalDebt: 1_000_000_000_000_000_000n,
  borrowFeeRatio: pool.borrowFeeRatio,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [],                                   // no ERC-20 input
  nfts: [{ nftAddress: poolAddress, tokenSubID: '0x' + positionId.toString(16),
           nftTokenType: NFTTokenType.ERC721, amount: 1n }],
});
```

No collateral movement, so no combo variant exists or is needed. Outputs:
position NFT + fxUSD (post-borrow-fee). **Caller responsibility:**
sanity-check the projected debt ratio against `pool.liquidationDebtRatio`
before constructing — borrowing more raises risk.

## Usage — repay debt (partial repay)

```ts
import {
  FxMintRepayDebtRecipe,
  computeFxRepay,
  getFxPool,
  getFxPosition,
  FX_ADDRESSES,
} from '@railgun-community/cookbook';

const pool = await getFxPool('wstETH-Long', provider);
const position = await getFxPosition(positionId, 'wstETH-Long', provider);

// Caller decides how much to repay; the helper caps at the three-way min
// (fee ceiling, current debt, user's intent) and computes the approve amount.
const { repayAmount, approveAmount } = computeFxRepay({
  debt: position.debt,                    // NATIVE, never position.rawDebts
  availableDebtToken,                     // balance of pool.debtToken
  desiredRepayAmount: 2_000_000_000_000_000_000n,
  repayFeeRatio: pool.repayFeeRatio,
  railgunUnshieldFeeBps: 25n,
});

const recipe = new FxMintRepayDebtRecipe({
  pool: 'wstETH-Long',
  positionId,
  repayAmount,
  approveAmount,
  repayFeeRatio: pool.repayFeeRatio,
});
```

Pool-agnostic (no collateral movement, no swap leg, no combo variant). Outputs:
position NFT, plus any unspent fxUSD (the recipe engine's epilogue shields
unconsumed input ERC-20s back automatically).

## Migration (breaking)

The `swapQuote` / `slippageBasisPoints` options are **removed** from
`FxMintOpenRecipe`, `FxMintCloseRecipe`, `FxMintTopupRecipe`, and
`FxMintTopupAndBorrowRecipe`. `validatePoolFlow` and `SwapDirection` are removed
from the package. `FxMintBorrowMoreRecipe` and `FxMintRepayDebtRecipe` are
unchanged.

```ts
// BEFORE (v0.1) — caller fetched the quote, WETH was the only entry token
const swapQuote = await fetchZeroXQuote(/* WETH → wstETH, guessed amount */);
const recipe = new FxMintOpenRecipe({
  pool: 'wstETH-Long',
  targetDebt, predictedPositionId, borrowFeeRatio,
  swapQuote,
  slippageBasisPoints: 5,
});
await recipe.getRecipeOutput({ erc20Amounts: [{ tokenAddress: WETH, ... }], ... });

// AFTER — the combo quotes itself, from any token
const combo = new ZeroXSwap_FxMintOpen_ComboMeal({
  pool: 'wstETH-Long',
  targetDebt, predictedPositionId, borrowFeeRatio,
  sellERC20Info: { tokenAddress: WETH, decimals: 18n, isBaseToken: false },
  swapSlippageBasisPoints: 5,
  recipient: ephemeralExecutor,
});
await combo.getComboMealOutput({ erc20Amounts: [{ tokenAddress: WETH, ... }], ... });
```

**Watch for the silent break.** Dropping `swapQuote` is a type error, but the
input token is not: a caller who keeps passing WETH to `FxMintOpenRecipe` for
`wstETH-Long` now gets a thrown
`fxmint: no 0x7f39…E2Ca0 in input.erc20Amounts` instead of a silent
WETH→wstETH swap. Likewise `FxMintCloseRecipe` now shields the pool collateral
back, never WETH.

Two defects were fixed alongside the refactor, both of which could break a
working integration:

- the deposit steps encoded the *optimistic* swap output into `operate()`, so
  any fill below quote reverted the batch. They now encode the guaranteed
  minimum and reshield the surplus.
- `ComboMeal` summed NFT recipient amounts across recipes, producing `amount 2n`
  for an ERC-721 transiting a seam — rejected outright by the step validator. It
  now takes the downstream recipe's amount.

## Read API

For wallet integrators driving position-management UIs.

```ts
import { getFxPool, getFxPosition } from '@railgun-community/cookbook';

// Pool-level state + per-(pool, operator) fee ratios.
const pool = await getFxPool('wstETH-Long', provider);
// pool.{address, collateralToken, collateralDecimals,
//      debtCapacity, debtBalance, totalRawColls, collateralBalance,
//      liquidationDebtRatio,        // 1e18-scaled; mainnet 0.95e18 (95%)
//      liquidationBonusRatio,       // 1e9-scaled; liquidator's bonus
//      rebalanceDebtRatio,          // 1e18-scaled; mainnet 0.88e18 (88%)
//      rebalanceBonusRatio,         // 1e9-scaled; rebalancer's bonus (2.5%)
//      borrowFeeRatio,              // 1e9-scaled
//      repayFeeRatio}               // 1e9-scaled

// Per-position state, native-decimals collateral.
const position = await getFxPosition(positionId, 'wstETH-Long', provider);
// position.{positionId, pool: {address, name?}, collateralToken,
//          collateralDecimals, collateralAmount, rawColls, rawDebts,
//          debt, debtRatio}
```

`getFxPool`'s optional third arg is the operator address whose
per-(pool, operator) fee table is queried. It defaults to
`DEFAULT_FXMINT_OPERATOR`.

> **Integrator note — `DEFAULT_FXMINT_OPERATOR` under EIP-7702.** The constant
> is pinned to the Railgun relay-adapt address, but under 7702 the `operator`
> f(x) sees is the **ephemeral EOA**. Measured on mainnet (Jul 2026),
> `getPoolFeeRatio` returns the *same* tuple
> (`borrow = 5_000_000`, `repay = 2_000_000`, 1e9-denominated) for every operator
> tried on both pools — relay-adapt, unrelated EOAs, and the zero address — so
> the pinned default is currently harmless.
>
> The signature still takes an `operator`, so f(x) retains the ability to
> differentiate (a per-operator discount would be invisible to a recipe reading
> the default). Integrators that care about long-lived correctness should pass
> the executing account as `operator` rather than relying on the constant.

Both functions perform sequential on-chain reads (no batching baked in).
Integrators wanting a single-roundtrip read can compose with a Multicall3
helper against the same function selectors.

All shielded fxmint positions are owned-of-record by the ephemeral EOA that
executed the batch, so a "list positions by owner" call at this layer is not
meaningful for a wallet. Wallets enumerate the user's shielded NFTs (their own
job, since only the wallet's keys can decrypt shielded ownership) and feed each
`positionId` into `getFxPosition`.

## Calibration

### v0 (Apr 2026)

- Open: [`0x10f5ca84`](https://etherscan.io/tx/0x10f5ca84e4f5b1e622112dd089de6d0b07a1a90ff2e7aa4769694fd8980bd42d)
  (manual), [`0x3f7c7c42`](https://etherscan.io/tx/0x3f7c7c4256e2473c4e663daef84fa3d7137e711d7f24d2d47d2b98e4f14a09c5) (CLI)
- Close: [`0xfc299fb7`](https://etherscan.io/tx/0xfc299fb738fccb36841fcb6b61fd80e8a9ab1216d8df20d4090e88651c18edb0)
  (manual), [`0x5d0685ab`](https://etherscan.io/tx/0x5d0685abeb39879b411b95aa275ea3b4ca3813f6a9127f8dedd0f7cc725dfd94) (CLI)

### v0.1 (May 2026) — historical

These broadcasts calibrated the recipe math and are still the reference for the
`operate()` amounts and fee handling. The **swap-path rows are no longer
reachable through these recipes** — that leg now lives in a ComboMeal.

| Op | Pool | Path | Tx |
|---|---|---|---|
| Open (re-cal, dynamic borrow fee) | wstETH-Long | swap (WETH→wstETH) | [`0x71439e52`](https://etherscan.io/tx/0x71439e529690fd1a3d412d2d5a9461d94cd5d95a4e3e4966336d138d17e4ab32) |
| Topup | wstETH-Long | swap | [`0xac787ca8`](https://etherscan.io/tx/0xac787ca87e8b24418010994579ec79399b28c1d6144ba394f048257998e35613) |
| Borrow-more | wstETH-Long | n/a (debt-only) | [`0x09a3bd9d`](https://etherscan.io/tx/0x09a3bd9db0d3ffdb1860d3f35df774f7632c5b1fd8e5a118dc88fa4986f1e40c) |
| Repay-debt (partial) | wstETH-Long | n/a (debt-only) | [`0x4c8967b3`](https://etherscan.io/tx/0x4c8967b38d5d0728154f19fe69fb9a06d0baa8189a2219111f5767cfe458760c) |
| Open | WBTC-Long | direct (WBTC) | [`0x08b555df`](https://etherscan.io/tx/0x08b555df37b16c44a0bcb9b5a802e60726f1413f1572431deae2ac597d3fd1cd) |
| Close (partial) | WBTC-Long | direct (WBTC out) | [`0x92315478`](https://etherscan.io/tx/0x92315478123142346db24e1d9eda8d6767467e261bc86139492d296ddc581b65) |

### v0.2 (single-protocol recipes + combos) — pending

| Op | Pool | Tx |
|---|---|---|
| _first 7702 combo broadcast_ | _tbd_ | _tbd_ |

`minGasLimit` values (`MIN_GAS_LIMIT_FXMINT_*` in `src/models/min-gas-limits.ts`)
have **not** been measured against a 7702 execution — no fx recipe has ever run
on a fork.

They were, however, re-anchored, because the v0.1 values were provably wrong
independent of measurement: open and adjust sat at 1.5M while
`MIN_GAS_LIMIT_EMPTY` is a *measured* 1.8M for a recipe that only unshields and
shields. Every fx recipe strictly contains that, plus an approve, plus an
`operate()` that mints or burns an ERC-721. The floors are now 3.1M / 3.0M /
3.1M, anchored to the measured neighbours in the same file (beefy deposit 3.1M,
morpho blue supply+borrow 3.1M) rather than invented.

Deliberately generous: over-provisioning costs allowance, under-provisioning
reverts the batch. Short pools share the same constants and are the reason they
are sized upward — `ShortPoolManager._handleBorrow` calls into the *long*
manager via `counterparty` to source the debt token, so a short carries an extra
cross-contract hop and is strictly dearer than the equivalent long.

Real calibration needs the 7702 fork harness
(`.claude/plans/7702-execute-fork-harness`), which cannot execute in the current
container.

## File layout

```
src/recipes/borrow/fx/
  fx-mint-open-recipe.ts                 FxMintOpenRecipe
  fx-mint-close-recipe.ts                FxMintCloseRecipe
  fx-mint-topup-recipe.ts                FxMintTopupRecipe
  fx-mint-topup-and-borrow-recipe.ts     FxMintTopupAndBorrowRecipe
  fx-mint-borrow-more-recipe.ts          FxMintBorrowMoreRecipe
  fx-mint-repay-debt-recipe.ts           FxMintRepayDebtRecipe
src/combo-meals/fx/
  zero-x-swap-fx-mint-open-combo-meal.ts              ZeroXSwap_FxMintOpen_ComboMeal
  zero-x-swap-fx-mint-topup-combo-meal.ts             ZeroXSwap_FxMintTopup_ComboMeal
  zero-x-swap-fx-mint-topup-and-borrow-combo-meal.ts  ZeroXSwap_FxMintTopupAndBorrow_ComboMeal
  fx-mint-close-zero-x-swap-combo-meal.ts             FxMintClose_ZeroXSwap_ComboMeal
  util.ts                                fxCollateralERC20Info, assertSwapTokenIsNotCollateral
src/steps/borrow/fx/
  fx-mint-open-position-step.ts          FxMintOpenPositionStep
  fx-mint-close-position-step.ts         FxMintClosePositionStep
  fx-mint-adjust-position-step.ts        FxMintAdjustPositionStep   (topup/borrow-more/repay)
  fx-mint-util.ts                        addresses, ABIs, KNOWN_POOLS, computeFxClose,
                                         computeFxRepay, assertCollateralInput
src/api/borrow/fx/
  fx-position-reader.ts                  getFxPool, getFxPosition
```
