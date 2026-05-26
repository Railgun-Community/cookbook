import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { FxMintOpenRecipe, validatePoolFlow } from '../fx-mint-open-recipe';
import type { SwapQuoteData } from '../../../../models/export-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const fakeSwapQuote: SwapQuoteData = {
  sellTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (deposit direction)
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
  it('throws for wstETH-Long without swapQuote (deposit)', () => {
    expect(() => validatePoolFlow('wstETH-Long', undefined, 'deposit')).to.throw(
      /wstETH-Long/,
    );
  });

  it('throws for WBTC-Long with swapQuote (deposit)', () => {
    expect(() =>
      validatePoolFlow('WBTC-Long', fakeSwapQuote, 'deposit'),
    ).to.throw(/WBTC-Long/);
  });

  it('passes for wstETH-Long with valid deposit swapQuote', () => {
    expect(() =>
      validatePoolFlow('wstETH-Long', fakeSwapQuote, 'deposit'),
    ).not.to.throw();
  });

  it('passes for WBTC-Long without swapQuote (deposit)', () => {
    expect(() =>
      validatePoolFlow('WBTC-Long', undefined, 'deposit'),
    ).not.to.throw();
  });

  it('trusts custom pool refs on presence (does not throw on presence layer)', () => {
    const customPool = {
      address: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      collateralToken:
        '0x000000000000000000000000000000000000cafe' as `0x${string}`,
      collateralDecimals: 18n,
    };
    // Custom pool + no quote: passes (no shape check applies).
    expect(() =>
      validatePoolFlow(customPool, undefined, 'deposit'),
    ).not.to.throw();
    // Custom pool + quote with non-matching buy (cafe ≠ wstETH): shape layer
    // would now throw; this is covered explicitly by a shape-check test below.
  });

  // Shape-check tests — direction-aware (added in PR #53 follow-up).
  // Canonical mainnet addresses used to construct quotes with valid or
  // mismatched directions. WETH is the canonical fxmint swap input across
  // every deposit-direction recipe (open/topup/topup-and-borrow); wstETH
  // is the canonical wstETH-Long collateral. WRONG_TOKEN and CUSTOM_COLL
  // are throwaway placeholder addresses (matches the file's existing
  // 0x…beef / 0x…cafe convention for fake addresses in tests).
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
  const WRONG_TOKEN = '0x000000000000000000000000000000000000fade';
  const CUSTOM_COLL = '0x000000000000000000000000000000000000cafe';

  // ---- Deposit direction (open/topup/topup-and-borrow) ----

  it('throws when deposit-direction swapQuote sell token does not match WETH (wstETH-Long)', () => {
    const wrongSellQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WRONG_TOKEN, // wrong — deposit direction expects WETH
    };
    expect(() =>
      validatePoolFlow('wstETH-Long', wrongSellQuote, 'deposit'),
    ).to.throw(/sellTokenAddress mismatch.*deposit.*WETH/i);
  });

  it('throws when deposit-direction swapQuote buy token does not match pool collateralToken (wstETH-Long)', () => {
    const wrongBuyQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WETH,
      buyERC20Amount: { ...fakeSwapQuote.buyERC20Amount, tokenAddress: WRONG_TOKEN },
    };
    expect(() =>
      validatePoolFlow('wstETH-Long', wrongBuyQuote, 'deposit'),
    ).to.throw(/buyERC20Amount\.tokenAddress mismatch.*deposit.*pool collateral/i);
  });

  it('accepts mixed-case (checksum) addresses on the deposit path', () => {
    const upperCaseQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WETH.toUpperCase(),
      buyERC20Amount: {
        ...fakeSwapQuote.buyERC20Amount,
        tokenAddress: WSTETH.toUpperCase(),
      },
    };
    expect(() =>
      validatePoolFlow('wstETH-Long', upperCaseQuote, 'deposit'),
    ).not.to.throw();
  });

  it('passes for custom pool with correct WETH→collateral deposit quote', () => {
    const customPool = {
      address: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      collateralToken: CUSTOM_COLL as `0x${string}`,
      collateralDecimals: 18n,
    };
    const correctQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WETH,
      buyERC20Amount: { ...fakeSwapQuote.buyERC20Amount, tokenAddress: CUSTOM_COLL },
    };
    expect(() =>
      validatePoolFlow(customPool, correctQuote, 'deposit'),
    ).not.to.throw();
  });

  it('throws for custom pool with wrong-buy deposit quote', () => {
    const customPool = {
      address: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      collateralToken: CUSTOM_COLL as `0x${string}`,
      collateralDecimals: 18n,
    };
    const wrongBuyQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WETH,
      buyERC20Amount: {
        ...fakeSwapQuote.buyERC20Amount,
        tokenAddress: WSTETH, // wstETH ≠ pool.collateralToken (CUSTOM_COLL)
      },
    };
    expect(() =>
      validatePoolFlow(customPool, wrongBuyQuote, 'deposit'),
    ).to.throw(/buyERC20Amount\.tokenAddress mismatch.*deposit/i);
  });

  // ---- Withdraw direction (close) ----

  it('passes for wstETH-Long with correct withdraw-direction quote (wstETH→WETH)', () => {
    const withdrawQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: WSTETH,
      buyERC20Amount: { ...fakeSwapQuote.buyERC20Amount, tokenAddress: WETH },
    };
    expect(() =>
      validatePoolFlow('wstETH-Long', withdrawQuote, 'withdraw'),
    ).not.to.throw();
  });

  it('throws when withdraw-direction quote sells WETH instead of collateral (deposit-shaped)', () => {
    // Reusing fakeSwapQuote: sell = WETH, buy = wstETH (deposit shape).
    // Run it through withdraw direction — sell side mismatches.
    expect(() =>
      validatePoolFlow('wstETH-Long', fakeSwapQuote, 'withdraw'),
    ).to.throw(/sellTokenAddress mismatch.*withdraw.*pool collateral/i);
  });

  it('throws when withdraw-direction quote buys wrong token (not WETH)', () => {
    const wrongBuyWithdraw = {
      ...fakeSwapQuote,
      sellTokenAddress: WSTETH,
      buyERC20Amount: { ...fakeSwapQuote.buyERC20Amount, tokenAddress: WRONG_TOKEN },
    };
    expect(() =>
      validatePoolFlow('wstETH-Long', wrongBuyWithdraw, 'withdraw'),
    ).to.throw(/buyERC20Amount\.tokenAddress mismatch.*withdraw.*WETH/i);
  });

  it('passes for custom pool with correct withdraw quote (collateral→WETH)', () => {
    const customPool = {
      address: '0x000000000000000000000000000000000000beef' as `0x${string}`,
      collateralToken: CUSTOM_COLL as `0x${string}`,
      collateralDecimals: 18n,
    };
    const withdrawQuote = {
      ...fakeSwapQuote,
      sellTokenAddress: CUSTOM_COLL,
      buyERC20Amount: { ...fakeSwapQuote.buyERC20Amount, tokenAddress: WETH },
    };
    expect(() =>
      validatePoolFlow(customPool, withdrawQuote, 'withdraw'),
    ).not.to.throw();
  });
});
