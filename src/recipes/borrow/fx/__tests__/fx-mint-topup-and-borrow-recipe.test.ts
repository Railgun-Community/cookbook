import chai from 'chai';
import { FxMintTopupAndBorrowRecipe } from '../fx-mint-topup-and-borrow-recipe';
import type { SwapQuoteData } from '../../../../models/export-models';

const { expect } = chai;

// Minimal SwapQuoteData stub. Only the fields the recipe actually reads
// (spender for the pre-swap approve, buyERC20Amount.amount for the encoded
// collDelta on the swap path) matter; everything else is shape-correct
// placeholder. Pattern matches fx-mint-topup-recipe.test.ts.
const fakeSwapQuote = {
  sellTokenValue: '0',
  spender: '0x000000000000000000000000000000000000beef',
  crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
  buyERC20Amount: {
    tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', // wstETH
    decimals: 18n,
    amount: 1n,
  },
} as unknown as SwapQuoteData;

describe('FxMintTopupAndBorrowRecipe', () => {
  // Shared positive-debt opts; each test extends with the path-specific
  // pool/swapQuote shape. Mirrors topup recipe's `baseOpts` style but adds
  // the lever-up-only fields (additionalDebt, borrowFeeRatio).
  const baseOpts = {
    positionId: 1903n,
    additionalDebt: 1_000_000_000_000_000_000n, // 1 fxUSD
    borrowFeeRatio: 5_000_000n, // 0.5% in 1e9-denominated units
  };

  it('wstETH-Long: throws if swapQuote is missing', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'wstETH-Long',
    })).to.throw(/swapQuote required.*wstETH-Long|wstETH-Long.*swapQuote/i);
  });

  it('WBTC-Long: throws if swapQuote is provided', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'WBTC-Long',
      swapQuote: fakeSwapQuote,
      slippageBasisPoints: 5,
    })).to.throw(/WBTC-Long.*direct|WBTC-Long.*omit|swapQuote.*forbidden/i);
  });

  it('wstETH-Long with swapQuote: constructs', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'wstETH-Long',
      swapQuote: fakeSwapQuote,
      slippageBasisPoints: 5,
    })).not.to.throw();
  });

  it('WBTC-Long without swapQuote: constructs', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'WBTC-Long',
    })).not.to.throw();
  });

  it('throws if additionalDebt is 0n (use FxMintTopupRecipe instead)', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'WBTC-Long',
      additionalDebt: 0n,
    })).to.throw(/additionalDebt.*positive|use FxMintTopupRecipe|additionalDebt.*> 0/i);
  });

  it('throws if additionalDebt is negative', () => {
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'WBTC-Long',
      additionalDebt: -1n,
    })).to.throw(/additionalDebt/i);
  });

  it('throws if swapQuote provided without slippageBasisPoints', () => {
    // The constructor's slippage-pair guard: any time a swapQuote is
    // supplied, slippageBasisPoints must accompany it — otherwise the
    // ZeroXV2SwapStep ends up with no slippage bound at recipe time.
    // Mirrors the same guard on FxMintTopupRecipe / FxMintOpenRecipe.
    expect(() => new FxMintTopupAndBorrowRecipe({
      ...baseOpts,
      pool: 'wstETH-Long',
      swapQuote: fakeSwapQuote,
    } as never)).to.throw(/slippageBasisPoints/);
  });
});
