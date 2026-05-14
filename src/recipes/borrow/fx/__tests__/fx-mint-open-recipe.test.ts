import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { FxMintOpenRecipe, validatePoolFlow } from '../fx-mint-open-recipe';
import type { SwapQuoteData } from '../../../../models/export-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const fakeSwapQuote: SwapQuoteData = {
  sellTokenValue: '8000000000000000',
  spender: '0x000000000000000000000000000000000000beef',
  crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
  buyERC20Amount: {
    tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', // wstETH
    decimals: 18n,
    amount: 6_500_000_000_000_000n,
  },
} as unknown as SwapQuoteData;

describe('FxMintOpenRecipe — auto-branch + per-pool validation', () => {
  it('wstETH-Long: throws if swapQuote is missing', () => {
    expect(
      () =>
        new FxMintOpenRecipe({
          pool: 'wstETH-Long',
          targetDebt: 5_000_000_000_000_000_000n,
          predictedPositionId: 1903n,
          borrowFeeRatio: 5_000_000n,
        }),
    ).to.throw(/swapQuote required.*wstETH-Long|wstETH-Long.*swapQuote/i);
  });

  it('WBTC-Long: throws if swapQuote is provided', () => {
    expect(
      () =>
        new FxMintOpenRecipe({
          pool: 'WBTC-Long',
          targetDebt: 5_000_000_000_000_000_000n,
          predictedPositionId: 1903n,
          borrowFeeRatio: 5_000_000n,
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).to.throw(/WBTC-Long.*direct|swapQuote.*forbidden|WBTC-Long.*omit/i);
  });

  it('wstETH-Long with swapQuote constructs', () => {
    expect(
      () =>
        new FxMintOpenRecipe({
          pool: 'wstETH-Long',
          targetDebt: 5_000_000_000_000_000_000n,
          predictedPositionId: 1903n,
          borrowFeeRatio: 5_000_000n,
          swapQuote: fakeSwapQuote,
          slippageBasisPoints: 5,
        }),
    ).not.to.throw();
  });

  it('WBTC-Long without swapQuote constructs', () => {
    expect(
      () =>
        new FxMintOpenRecipe({
          pool: 'WBTC-Long',
          targetDebt: 5_000_000_000_000_000_000n,
          predictedPositionId: 1903n,
          borrowFeeRatio: 5_000_000n,
        }),
    ).not.to.throw();
  });

  it('throws if swapQuote provided without slippageBasisPoints', () => {
    expect(
      () =>
        new FxMintOpenRecipe({
          pool: 'wstETH-Long',
          targetDebt: 5_000_000_000_000_000_000n,
          predictedPositionId: 1903n,
          borrowFeeRatio: 5_000_000n,
          swapQuote: fakeSwapQuote,
          // slippageBasisPoints intentionally omitted
        } as never),
    ).to.throw(/slippageBasisPoints/);
  });
});

describe('validatePoolFlow', () => {
  it('throws for wstETH-Long without swapQuote', () => {
    expect(() => validatePoolFlow('wstETH-Long', undefined)).to.throw(
      /wstETH-Long/,
    );
  });

  it('throws for WBTC-Long with swapQuote', () => {
    expect(() => validatePoolFlow('WBTC-Long', fakeSwapQuote)).to.throw(
      /WBTC-Long/,
    );
  });

  it('passes for wstETH-Long with swapQuote', () => {
    expect(() => validatePoolFlow('wstETH-Long', fakeSwapQuote)).not.to.throw();
  });

  it('passes for WBTC-Long without swapQuote', () => {
    expect(() => validatePoolFlow('WBTC-Long', undefined)).not.to.throw();
  });

  it('trusts custom pool refs (does not throw)', () => {
    const customPool = {
      address: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      collateralToken:
        '0x000000000000000000000000000000000000cafe' as `0x${string}`,
      collateralDecimals: 18n,
    };
    expect(() => validatePoolFlow(customPool, fakeSwapQuote)).not.to.throw();
    expect(() => validatePoolFlow(customPool, undefined)).not.to.throw();
  });
});
