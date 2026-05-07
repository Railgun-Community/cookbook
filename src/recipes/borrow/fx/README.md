# f(x) Protocol — fxMINT recipes

Cookbook recipes for opening and closing [f(x) Protocol](https://fx.aladdin.club)
Long positions privately, by routing the operation through a Railgun
relay-adapter cross-contract call.

The recipes plug into any wallet that already consumes
`@railgun-community/cookbook` — adoption is the same shape as for any other
recipe (`new FxMintOpenRecipe(...).getRecipeOutput(input)`).

## What this is for

f(x) Protocol lets a user mint fxUSD against yield-bearing collateral
(wstETH, WBTC). These recipes wrap that flow as a Railgun cross-contract
call so a user can:

- **Open**: deposit shielded WETH, swap to collateral, mint fxUSD against an
  f(x) Long position; shield both the fxUSD and the position NFT back to
  the user's `0zk` address.
- **Close** (or partially close): unshield fxUSD, repay debt against the
  position, withdraw collateral, swap back to WETH; reshield the WETH and
  (for partial close) the surviving NFT.

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

## Usage — open a position

```ts
import {
  FxMintOpenRecipe,
  FX_ADDRESSES,
} from '@railgun-community/cookbook';
import { NetworkName } from '@railgun-community/shared-models';

const recipe = new FxMintOpenRecipe({
  pool: 'wstETH-Long',                               // or 'WBTC-Long'
  targetDebt: 5_000_000_000_000_000_000n,             // 5 fxUSD
  predictedPositionId: 1903n,                         // Pool.getNextPositionId()
  swapQuote,                                          // SwapQuoteData (WETH → wstETH)
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

## Usage — close a position

```ts
import {
  FxMintCloseRecipe,
  computeFxClose,
  FX_ADDRESSES,
} from '@railgun-community/cookbook';
import { NFTTokenType } from '@railgun-community/shared-models';

// Pre-compute the operate amounts from on-chain pool state. Handles three
// non-trivial pieces of math: the rawColls→wstETH pro-rata conversion,
// f(x)'s repay fee, and Railgun's 25 bps unshield fee.
const amounts = computeFxClose({
  rawColls,                  // Pool.getPosition(positionId)[0]
  rawDebts,                  // Pool.getPosition(positionId)[1]
  collateralBalance,         // PoolManager.getPoolInfo(pool)[1]
  totalRawColls,             // Pool.getTotalRawCollaterals()
  shieldedFxUSD,             // wallet.balanceForERC20Token(fxUSD)
  repayFeeRatio,             // PoolConfiguration.getPoolFeeRatio(pool, RailgunRelayAdapter)[3]
  railgunUnshieldFeeBps: 25n,
});

const recipe = new FxMintCloseRecipe({
  pool: 'wstETH-Long',
  positionId: 1903n,
  ...amounts,                 // { repayAmount, withdrawColl, approveAmount, partialClose, ... }
  swapQuote,                  // SwapQuoteData (wstETH → WETH)
  slippageBasisPoints: 5,
});

const recipeOutput = await recipe.getRecipeOutput({
  networkName: NetworkName.Ethereum,
  railgunAddress,
  erc20Amounts: [{ tokenAddress: FX_ADDRESSES.fxUSD, amount: shieldedFxUSD }],
  nfts: [{
    nftAddress: poolAddress,
    tokenSubID: '0x' + positionId.toString(16),       // hex form required
    nftTokenType: NFTTokenType.ERC721,
    amount: 1n,
  }],
});
```

## Pool support

Two mainnet pools are wired up by name. For new pools, pass an explicit
`{ address, collateralToken }` object as the `pool` arg.

| Name          | Pool address                                 | Collateral                                |
| ------------- | -------------------------------------------- | ----------------------------------------- |
| `wstETH-Long` | `0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8` | wstETH (`0x7f39C581…E2Ca0`)               |
| `WBTC-Long`   | `0xAB709e26Fa6B0A30c119D8c55B887DeD24952473` | WBTC (`0x2260FAC5…2C599`)                 |

f(x) shorts (fxBASE-side products) and the fxSAVE yield product are out of
scope of these recipes.

## Calibration

The `computeFxClose` math and the gotchas baked into both recipes were
calibrated against real-mainnet broadcasts during bring-up:

- Open: [`0x10f5ca84`](https://etherscan.io/tx/0x10f5ca84e4f5b1e622112dd089de6d0b07a1a90ff2e7aa4769694fd8980bd42d)
  (manual), [`0x3f7c7c42`](https://etherscan.io/tx/0x3f7c7c4256e2473c4e663daef84fa3d7137e711d7f24d2d47d2b98e4f14a09c5) (CLI)
- Close: [`0xfc299fb7`](https://etherscan.io/tx/0xfc299fb738fccb36841fcb6b61fd80e8a9ab1216d8df20d4090e88651c18edb0)
  (manual), [`0x5d0685ab`](https://etherscan.io/tx/0x5d0685abeb39879b411b95aa275ea3b4ca3813f6a9127f8dedd0f7cc725dfd94) (CLI)

## File layout

```
src/recipes/borrow/fx/
  fx-mint-open-recipe.ts             FxMintOpenRecipe
  fx-mint-close-recipe.ts            FxMintCloseRecipe
src/steps/borrow/fx/
  fx-mint-open-position-step.ts      FxMintOpenPositionStep
  fx-mint-close-position-step.ts     FxMintClosePositionStep
  fx-mint-util.ts                    addresses, ABIs, KNOWN_POOLS, computeFxClose
```
