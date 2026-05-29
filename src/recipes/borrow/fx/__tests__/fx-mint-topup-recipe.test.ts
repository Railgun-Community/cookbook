import chai from 'chai';
import { FxMintTopupRecipe } from '../fx-mint-topup-recipe';
import type { SwapQuoteData } from '../../../../models/export-models';

const { expect } = chai;

// Minimal SwapQuoteData stub. Only the fields the recipe actually reads
// (spender for the pre-swap approve, buyERC20Amount.amount for the encoded
// collDelta on the swap path) matter; everything else is shape-correct
// placeholder. Pattern matches fx-mint-close-recipe.test.ts.
const fakeSwapQuote = {
  sellTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (deposit direction)
  sellTokenValue: '0',
  spender: '0x000000000000000000000000000000000000beef',
  crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
  buyERC20Amount: {
    tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', // wstETH
    decimals: 18n,
    amount: 1n,
  },
} as unknown as SwapQuoteData;

describe('FxMintTopupRecipe', () => {
  it('wstETH-Long: throws if swapQuote is missing', () => {
    expect(
      () =>
        new FxMintTopupRecipe({
          pool: 'wstETH-Long',
          positionId: 1903n,
        }),
    ).to.throw(/swapQuote required.*wstETH-Long|wstETH-Long.*swapQuote/i);
  });

  it('WBTC-Long: throws if swapQuote is provided', () => {
    expect(
      () =>
        new FxMintTopupRecipe({
          pool: 'WBTC-Long',
          positionId: 1903n,
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).to.throw(/WBTC-Long.*direct|WBTC-Long.*omit|swapQuote.*forbidden/i);
  });

  it('wstETH-Long with swapQuote: constructs', () => {
    expect(
      () =>
        new FxMintTopupRecipe({
          pool: 'wstETH-Long',
          positionId: 1903n,
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).not.to.throw();
  });

  it('WBTC-Long without swapQuote: constructs', () => {
    expect(
      () =>
        new FxMintTopupRecipe({
          pool: 'WBTC-Long',
          positionId: 1903n,
        }),
    ).not.to.throw();
  });

  it('throws if swapQuote provided without slippageBasisPoints', () => {
    expect(
      () =>
        new FxMintTopupRecipe({
          pool: 'wstETH-Long',
          positionId: 1903n,
          swapQuote: fakeSwapQuote,
        } as never),
    ).to.throw(/slippageBasisPoints/);
  });
});
