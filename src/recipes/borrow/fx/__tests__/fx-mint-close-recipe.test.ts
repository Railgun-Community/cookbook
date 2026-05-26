import chai from 'chai';
import { FxMintCloseRecipe } from '../fx-mint-close-recipe';
import type { SwapQuoteData } from '../../../../models/export-models';

const { expect } = chai;

// Minimal SwapQuoteData stub. Only the fields the recipe actually reads
// (spender for the post-close approve, buyERC20Amount for ZeroXV2SwapStep)
// matter; everything else is filled with placeholder values that are
// shape-correct but not exercised by the constructor-time validation tests.
const fakeSwapQuote = {
  sellTokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', // wstETH (withdraw direction sells collateral)
  sellTokenValue: '0',
  spender: '0x000000000000000000000000000000000000beef',
  crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
  buyERC20Amount: {
    tokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    decimals: 18n,
    amount: 1n,
  },
} as unknown as SwapQuoteData;

describe('FxMintCloseRecipe — auto-branch + per-pool validation', () => {
  // Shared close-side numbers. approveAmount = repayAmount × (1e9 + 5e6) / 1e9
  // matches the close-fee shape produced by computeFxClose at a 0.5% repay
  // fee (5_000_000 / 1e9). The recipe doesn't recompute these — it just
  // plumbs them — so the values here only need to be internally consistent.
  const baseOpts = {
    positionId: 1903n,
    repayAmount: 5_000_000_000_000_000_000n,
    withdrawColl: 4_000_000_000_000_000n,
    approveAmount: 5_025_000_000_000_000_000n,
    partialClose: true,
  };

  it('wstETH-Long: throws if swapQuote is missing', () => {
    expect(
      () =>
        new FxMintCloseRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
        }),
    ).to.throw(/swapQuote required.*wstETH-Long|wstETH-Long.*swapQuote/i);
  });

  it('WBTC-Long: throws if swapQuote is provided', () => {
    expect(
      () =>
        new FxMintCloseRecipe({
          ...baseOpts,
          pool: 'WBTC-Long',
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).to.throw(/WBTC-Long.*direct|WBTC-Long.*omit|swapQuote.*forbidden/i);
  });

  it('wstETH-Long with swapQuote: constructs', () => {
    expect(
      () =>
        new FxMintCloseRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).not.to.throw();
  });

  it('WBTC-Long without swapQuote: constructs', () => {
    expect(
      () =>
        new FxMintCloseRecipe({
          ...baseOpts,
          pool: 'WBTC-Long',
        }),
    ).not.to.throw();
  });

  it('throws if swapQuote provided without slippageBasisPoints', () => {
    expect(
      () =>
        new FxMintCloseRecipe({
          ...baseOpts,
          pool: 'wstETH-Long',
          swapQuote: fakeSwapQuote,
          // slippageBasisPoints intentionally omitted
        } as never),
    ).to.throw(/slippageBasisPoints/);
  });
});
