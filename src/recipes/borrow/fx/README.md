# f(x) Protocol — fxMINT recipes

Cookbook recipes for opening, closing, and managing [f(x) Protocol](https://fx.aladdin.club)
debt positions privately, by routing each operation through a Railgun
relay-adapter cross-contract call.

The recipes plug into any wallet that already consumes
`@railgun-community/cookbook` — adoption is the same shape as for any other
recipe (`new FxMintOpenRecipe(...).getRecipeOutput(input)`).

## What this is for

f(x) Protocol lets a user mint fxUSD against tier one collaterals
(wstETH, WBTC) without recurring costs (one time fee) and with a unique liquidation design that prevents any hard liquidation.

Every position is wrapped into an NFT while the collateral is pooled at protocol level to make progressive liquidations possible. It unlocks the possibility of borrowing privately through Railgun while having a liquidatable debt position.

These recipes wrap that flow as a Railgun cross-contract
call so a user can:

- **Open** a debt position: deposit shielded WETH (or shielded WBTC for
  WBTC-Long), mint fxUSD against an f(x) Long position; shield the fxUSD
  and the position NFT back to the user's `0zk` address.
- **Close** (or partially close): unshield fxUSD, repay debt against the
  position, withdraw collateral, optionally swap back to WETH; reshield
  the proceeds and (for partial close) the surviving NFT.
- **Top up collateral**: add collateral to an existing position without
  changing debt. The position's debt ratio falls — risk-management dial.
- **Top up + borrow more**: add collateral AND mint additional fxUSD in
  one atomic `operate()`. Increases exposure (lever-up).
- **Borrow more**: mint additional fxUSD against an existing position
  without adding collateral. Raises the debt ratio — caller should
  sanity-check against the pool's liquidation threshold first.
- **Repay debt**: burn fxUSD to reduce an existing position's debt
  without withdrawing collateral. Symmetric counterpart to top-up — the
  other risk-management dial.

What's hidden: the link between the user's wallet and the on-chain f(x)
position. What's still public: the position's collateral, debt, and health
on f(x); the on-chain owner-of-record (a Railgun relay-adapter address
shared by all users); the fact that a Railgun cross-contract call
interacted with f(x). f(x)'s liquidation flow operates against the public
position state regardless of who deposited.

## Install

Once these recipes land in upstream `@railgun-community/cookbook`:

```bash
npm install @railgun-community/cookbook
```

Until then, integrators can pin the fork directly:

```bash
npm install github:Squabble9/cookbook#fxmint-v0.1
```

## Pool support

Two mainnet pools are wired up by name. For new pools, pass an explicit
`{ address, collateralToken, collateralDecimals }` object as the `pool` arg.

| Name          | Pool address                                 | Collateral                                | Decimals |
| ------------- | -------------------------------------------- | ----------------------------------------- | -------- |
| `wstETH-Long` | `0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8` | wstETH (`0x7f39C581…E2Ca0`)               | 18       |
| `WBTC-Long`   | `0xAB709e26Fa6B0A30c119D8c55B887DeD24952473` | WBTC (`0x2260FAC5…2C599`)                 | 8        |

The recipes auto-branch their step graph based on the `swapQuote` opt:

- **wstETH-Long** uses the **swap path** — WETH input + 0x v2 swap leg
  (WETH↔wstETH). `swapQuote` is required.
- **WBTC-Long** uses the **direct path** — WBTC input/output, no swap
  leg. `swapQuote` must be omitted.
- **Custom pool refs** are trusted: caller picks the path by providing or
  omitting `swapQuote`.

f(x) shorts (fxBASE-side products) and the fxSAVE yield product are out
of scope of these recipes.

## On-chain parameters — fetch dynamically

f(x) governance can rotate the per-pool borrow fee, repay fee, and
liquidation threshold via `PoolConfiguration` and `Pool` admin functions.
Recipes that touch these parameters take them as constructor args; the
caller is expected to fetch live values via `getFxPool` (see Read API)
rather than hardcoding. None of the v0.1 recipes embed fee or threshold
constants.

## Usage — open a position

```ts
import {
  FxMintOpenRecipe,
  FX_ADDRESSES,
  getFxPool,
} from '@railgun-community/cookbook';
import { NetworkName } from '@railgun-community/shared-models';

// Fetch live borrow fee + other pool state (single helper, see Read API):
const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintOpenRecipe({
  pool: 'wstETH-Long',                               // or 'WBTC-Long' (omit swapQuote)
  targetDebt: 5_000_000_000_000_000_000n,             // 5 fxUSD
  predictedPositionId: 1903n,                         // Pool.getNextPositionId()
  borrowFeeRatio: pool.borrowFeeRatio,                // 1e9-denom, governance-upgradable
  swapQuote,                                          // SwapQuoteData (WETH → wstETH); omit for WBTC-Long
  slippageBasisPoints: 5,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,                                     // user's 0zk address
  erc20Amounts: [
    { tokenAddress: FX_ADDRESSES.WETH, amount: 8_000_000_000_000_000n }, // 0.008 WETH
  ],
  nfts: [],
});

// Feed `recipeOutput.crossContractCalls` / `.erc20AmountRecipients` /
// `.nftAmountRecipients` to the standard Railgun proof+populate+broadcast
// pipeline (gasEstimateForUnprovenCrossContractCalls →
// generateCrossContractCallsProof → populateProvedCrossContractCalls).
```

For WBTC-Long, swap the input asset to WBTC, omit `swapQuote` +
`slippageBasisPoints`. The recipe assembles a 2-step direct path
(`Approve(PoolMgr) → operate(open)`) instead of the 4-step swap path.

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

// Fetch live pool state + position state in two reads.
const pool = await getFxPool('wstETH-Long', provider);
const position = await getFxPosition(positionId, 'wstETH-Long', provider);

// Pre-compute the operate amounts. Handles three non-trivial pieces of
// math: the rawColls→native pro-rata conversion, f(x)'s repay fee, and
// Railgun's 25 bps unshield fee.
const amounts = computeFxClose({
  rawColls: position.rawColls,
  rawDebts: position.rawDebts,
  collateralBalance: pool.collateralBalance,
  totalRawColls: pool.totalRawColls,
  shieldedFxUSD,                          // wallet.balanceForERC20Token(fxUSD)
  repayFeeRatio: pool.repayFeeRatio,
  railgunUnshieldFeeBps: 25n,
});

const recipe = new FxMintCloseRecipe({
  pool: 'wstETH-Long',
  positionId,
  ...amounts,                             // { repayAmount, withdrawColl, approveAmount, partialClose, ... }
  swapQuote,                              // SwapQuoteData (wstETH → WETH); omit for WBTC-Long
  slippageBasisPoints: 5,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{ tokenAddress: FX_ADDRESSES.fxUSD, amount: shieldedFxUSD }],
  nfts: [{
    nftAddress: pool.address,             // per-pool NFT contract
    tokenSubID: '0x' + positionId.toString(16),
    nftTokenType: NFTTokenType.ERC721,
    amount: 1n,
  }],
});
```

## Usage — top up collateral

```ts
import { FxMintTopupRecipe, FX_ADDRESSES } from '@railgun-community/cookbook';

const recipe = new FxMintTopupRecipe({
  pool: 'wstETH-Long',                               // or 'WBTC-Long' (omit swapQuote)
  positionId: 1903n,
  swapQuote,                                          // WETH → wstETH; omit for WBTC-Long
  slippageBasisPoints: 5,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{
    tokenAddress: FX_ADDRESSES.WETH,                 // or WBTC for WBTC-Long
    amount: 2_000_000_000_000_000n,                  // 0.002 WETH
  }],
  nfts: [{
    nftAddress: poolAddress,
    tokenSubID: '0x' + positionId.toString(16),
    nftTokenType: NFTTokenType.ERC721,
    amount: 1n,
  }],
});
```

Inputs: WETH (swap path) or pool collateral (direct path), plus the
position NFT. Outputs (shielded back): the same position NFT (top-up
preserves the NFT identifier; only full close burns it). No fxUSD output
— debt is unchanged.

## Usage — top up and borrow more

```ts
import { FxMintTopupAndBorrowRecipe, getFxPool } from '@railgun-community/cookbook';

const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintTopupAndBorrowRecipe({
  pool: 'wstETH-Long',
  positionId: 1903n,
  additionalDebt: 1_000_000_000_000_000_000n,        // mint +1 fxUSD on top of the existing debt
  borrowFeeRatio: pool.borrowFeeRatio,
  swapQuote,                                          // WETH → wstETH; omit for WBTC-Long
  slippageBasisPoints: 5,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{ tokenAddress: FX_ADDRESSES.WETH, amount: 2_000_000_000_000_000n }],
  nfts: [{ nftAddress: poolAddress, tokenSubID: '0x' + positionId.toString(16),
           nftTokenType: NFTTokenType.ERC721, amount: 1n }],
});
```

Combines a collateral top-up with a fxUSD mint in a single atomic
`PoolManager.operate(positionId, +coll, +debt)`. Outputs: position NFT +
fxUSD (post-borrow-fee net).

## Usage — borrow more

```ts
import { FxMintBorrowMoreRecipe, getFxPool } from '@railgun-community/cookbook';

const pool = await getFxPool('wstETH-Long', provider);

const recipe = new FxMintBorrowMoreRecipe({
  pool: 'wstETH-Long',                               // pool-agnostic; works the same on WBTC-Long
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

No collateral movement, no swap leg. Pool-agnostic: same step graph
regardless of which pool. Outputs: position NFT + fxUSD (post-borrow-fee).
**Caller responsibility:** sanity-check the projected debt ratio against
`pool.liquidationDebtRatio` before constructing — borrowing more raises
risk.

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
// (fee ceiling, current debt, user's intent) and computes the approve
// amount (= repayAmount × (1 + repayFeeRatio/1e9)) for the relay-adapter.
const { repayAmount, approveAmount } = computeFxRepay({
  rawDebts: position.rawDebts,
  shieldedFxUSD,                          // wallet.balanceForERC20Token(fxUSD)
  desiredRepayAmount: 2_000_000_000_000_000_000n,    // repay up to 2 fxUSD
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

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{ tokenAddress: FX_ADDRESSES.fxUSD, amount: shieldedFxUSD }],
  nfts: [{ nftAddress: poolAddress, tokenSubID: '0x' + positionId.toString(16),
           nftTokenType: NFTTokenType.ERC721, amount: 1n }],
});
```

Pool-agnostic (no collateral movement, no swap leg). Outputs: position
NFT, plus any unspent fxUSD (cookbook's recipe-engine epilogue shields
unconsumed input ERC-20s back automatically).

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
//      rebalanceDebtRatio,          // 1e18-scaled; mainnet 0.88e18 (88%) — yellow zone
//      rebalanceBonusRatio,         // 1e9-scaled; rebalancer's bonus (2.5%)
//      borrowFeeRatio,              // 1e9-scaled
//      repayFeeRatio}               // 1e9-scaled

// Per-position state, native-decimals collateral.
const position = await getFxPosition(positionId, 'wstETH-Long', provider);
// position.{positionId, pool: {address, name?}, collateralToken,
//          collateralDecimals,
//          collateralAmount,        // native-decimals (8 for WBTC, 18 for wstETH)
//          rawColls, rawDebts,      // f(x)-internal scale
//          debt,                    // alias for rawDebts (fxUSD wei, no scaling step)
//          debtRatio}               // 1e18-scaled, compare with pool.liquidationDebtRatio
```

`getFxPool`'s optional third arg is the operator address whose
per-(pool, operator) fee table is queried. Defaults to the Railgun
relay-adapter (`DEFAULT_FXMINT_OPERATOR`) — exported as a constant from
the package root for non-Railgun consumers that want to override.

> **Integrator note: `DEFAULT_FXMINT_OPERATOR` is pinned to today's
> Railgun relay-adapter address.** If the Railgun engine rotates that
> address in a future release, this constant has to be updated in
> lockstep — apps that import the cookbook will silently query the wrong
> fee table until they upgrade. Wallet integrators that care about
> long-lived correctness should pass `operator` explicitly to `getFxPool`
> (read it from their own Railgun engine version), rather than relying
> on the default.

Both functions perform sequential on-chain reads (no batching baked in).
Integrators wanting a single-roundtrip read can compose with ethers'
Multicall3 helper (or any external batcher) against the same function
selectors. A v0.2 batched reader is on the roadmap if integrators ask.

All shielded fxmint positions on-chain are owned-of-record by the
Railgun relay-adapter, so a "list positions by owner" call at this layer
would return every fxmint user's positions — not meaningful for a single
wallet. Wallets enumerate the user's shielded NFTs (their own job, since
only the wallet's keys can decrypt shielded ownership) and feed each
`positionId` into `getFxPosition`.

## Calibration

The math and gotchas baked into these recipes were calibrated against
real-mainnet broadcasts during bring-up:

### v0 (Apr 2026)

- Open: [`0x10f5ca84`](https://etherscan.io/tx/0x10f5ca84e4f5b1e622112dd089de6d0b07a1a90ff2e7aa4769694fd8980bd42d)
  (manual), [`0x3f7c7c42`](https://etherscan.io/tx/0x3f7c7c4256e2473c4e663daef84fa3d7137e711d7f24d2d47d2b98e4f14a09c5) (CLI)
- Close: [`0xfc299fb7`](https://etherscan.io/tx/0xfc299fb738fccb36841fcb6b61fd80e8a9ab1216d8df20d4090e88651c18edb0)
  (manual), [`0x5d0685ab`](https://etherscan.io/tx/0x5d0685abeb39879b411b95aa275ea3b4ca3813f6a9127f8dedd0f7cc725dfd94) (CLI)

### v0.1 (May 2026)

| Op | Pool | Path | Tx |
|---|---|---|---|
| Open (re-cal, dynamic borrow fee) | wstETH-Long | swap (WETH→wstETH) | [`0x71439e52`](https://etherscan.io/tx/0x71439e529690fd1a3d412d2d5a9461d94cd5d95a4e3e4966336d138d17e4ab32) |
| Topup | wstETH-Long | swap | [`0xac787ca8`](https://etherscan.io/tx/0xac787ca87e8b24418010994579ec79399b28c1d6144ba394f048257998e35613) |
| Borrow-more | wstETH-Long | n/a (debt-only) | [`0x09a3bd9d`](https://etherscan.io/tx/0x09a3bd9db0d3ffdb1860d3f35df774f7632c5b1fd8e5a118dc88fa4986f1e40c) |
| Repay-debt (partial) | wstETH-Long | n/a (debt-only) | [`0x4c8967b3`](https://etherscan.io/tx/0x4c8967b38d5d0728154f19fe69fb9a06d0baa8189a2219111f5767cfe458760c) |
| Open | WBTC-Long | direct (WBTC) | [`0x08b555df`](https://etherscan.io/tx/0x08b555df37b16c44a0bcb9b5a802e60726f1413f1572431deae2ac597d3fd1cd) |
| Close (partial) | WBTC-Long | direct (WBTC out) | [`0x92315478`](https://etherscan.io/tx/0x92315478123142346db24e1d9eda8d6767467e261bc86139492d296ddc581b65) |

WBTC-Long topup is structurally identical to wstETH-Long topup at the
step-graph level (same `FxMintAdjustPositionStep` with `collDelta > 0,
debtDelta = 0`; only the leading approve target differs); the WBTC
direct input path is exercised by the WBTC-Long open above, so the topup
calibration was skipped for v0.1.

## File layout

```
src/recipes/borrow/fx/
  fx-mint-open-recipe.ts                 FxMintOpenRecipe
  fx-mint-close-recipe.ts                FxMintCloseRecipe
  fx-mint-topup-recipe.ts                FxMintTopupRecipe
  fx-mint-topup-and-borrow-recipe.ts     FxMintTopupAndBorrowRecipe
  fx-mint-borrow-more-recipe.ts          FxMintBorrowMoreRecipe
  fx-mint-repay-debt-recipe.ts           FxMintRepayDebtRecipe
src/steps/borrow/fx/
  fx-mint-open-position-step.ts          FxMintOpenPositionStep
  fx-mint-close-position-step.ts         FxMintClosePositionStep
  fx-mint-adjust-position-step.ts        FxMintAdjustPositionStep   (shared by topup/borrow-more/repay)
  fx-mint-util.ts                        addresses, ABIs, KNOWN_POOLS, computeFxClose, computeFxRepay
src/api/borrow/fx/
  fx-position-reader.ts                  getFxPool, getFxPosition
```
