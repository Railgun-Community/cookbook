import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Interface } from 'ethers';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import Sinon, { SinonStub } from 'sinon';
import {
  RecipeERC20Info,
  RecipeInput,
  type SwapQuoteDataV2,
} from '../../../models/export-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { ZeroXV2Quote } from '../../../api/zero-x-v2/zero-x-v2-quote';
import {
  FX_POOL_MANAGER_ABI,
  computeFxRepay,
  resolvePool,
} from '../../../steps/borrow/fx/fx-mint-util';
import { ZeroXSwap_FxMintRepay_ComboMeal } from '../zero-x-swap-fx-mint-repay-combo-meal';
import { quoteFxSwapRepay } from '../quote-fx-swap-repay';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const EXECUTOR = '0x1111111111111111111111111111111111111111';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const usdcInfo: RecipeERC20Info = {
  tokenAddress: USDC,
  decimals: 6n,
  isBaseToken: false,
};

const longPool = resolvePool('wstETH-Long');
const shortPool = resolvePool('stETH-Short');
const POSITION_ID = 1903n;

const EXPECTED_BUY = 500_000_000_000_000_000n;
const MINIMUM_BUY = 495_000_000_000_000_000n;
// Above both fills, so the repay tracks what the swap delivers instead of
// capping at the debt — otherwise an optimistic and a conservative sizing come
// out identical and the rejection test below proves nothing.
const DEBT = 1_000_000_000_000_000_000n;

const stubQuoteBuying = (
  tokenAddress: string,
  decimals: bigint,
  amount: bigint,
  minimumBuyAmount: bigint,
): SinonStub =>
  Sinon.stub(ZeroXV2Quote, 'getSwapQuote').callsFake(
    // eslint-disable-next-line @typescript-eslint/require-await
    async params =>
      ({
        sellTokenValue: params.sellERC20Amount.amount.toString(),
        spender: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', // pragma: allowlist secret
        crossContractCall: { to: '0x1234', value: 0n, data: '0x5678' },
        buyERC20Amount: { tokenAddress, decimals, amount },
        minimumBuyAmount,
        sellTokenAddress: params.sellERC20Amount.tokenAddress,
        price: 0n,
        guaranteedPrice: 0n,
        slippageBasisPoints: 100n,
        zid: '111111111111111111',
      } as unknown as SwapQuoteDataV2),
  );

const positionNFT = (poolAddress: string) => ({
  nftAddress: poolAddress,
  tokenSubID: '0x' + POSITION_ID.toString(16),
  nftTokenType: NFTTokenType.ERC721,
  amount: 1n,
});

const comboInput = (nfts: RecipeInput['nfts'] = []): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [
    { tokenAddress: USDC, decimals: 6n, isBaseToken: false, amount: 1_000_000_000n },
  ],
  nfts,
});

/** The repay magnitude encoded into `operate()` — argument 3, negated. */
const encodedRepay = (
  calls: { to?: string; data: string }[],
  manager: string,
): bigint => {
  const iface = new Interface(FX_POOL_MANAGER_ABI);
  for (const call of calls) {
    if (call.to?.toLowerCase() !== manager.toLowerCase()) {
      continue;
    }
    return -(iface.decodeFunctionData('operate', call.data)[3] as bigint);
  }
  throw new Error(`no operate() call found targeting ${manager}`);
};

/** Collateral delta — must be zero: a repay never touches collateral. */
const encodedCollateralDelta = (
  calls: { to?: string; data: string }[],
  manager: string,
): bigint => {
  const iface = new Interface(FX_POOL_MANAGER_ABI);
  for (const call of calls) {
    if (call.to?.toLowerCase() !== manager.toLowerCase()) {
      continue;
    }
    return iface.decodeFunctionData('operate', call.data)[2] as bigint;
  }
  throw new Error(`no operate() call found targeting ${manager}`);
};

const repayFor = (available: bigint) =>
  computeFxRepay({
    debt: DEBT,
    availableDebtToken: available,
    desiredRepayAmount: DEBT,
    repayFeeRatio: 0n,
    railgunUnshieldFeeBps: 0n,
  });

const comboFor = (available: bigint, pool: 'wstETH-Long' | 'stETH-Short') => {
  const amounts = repayFor(available);
  return new ZeroXSwap_FxMintRepay_ComboMeal({
    pool,
    positionId: POSITION_ID,
    repayAmount: amounts.repayAmount,
    approveAmount: amounts.approveAmount,
    repayFeeRatio: 0n,
    sellERC20Info: usdcInfo,
    swapSlippageBasisPoints: 100,
    recipient: EXECUTOR,
  });
};

describe('ZeroXSwap_FxMintRepay_ComboMeal', () => {
  let stub0xQuote: SinonStub;

  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  afterEach(() => {
    stub0xQuote?.restore();
  });

  it('Should buy the pool debt token, derived from the pool', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    await comboFor(MINIMUM_BUY, 'wstETH-Long').getComboMealOutput(
      comboInput([positionNFT(longPool.address)]),
    );

    expect(
      stub0xQuote.firstCall.args[0].buyERC20Info.tokenAddress.toLowerCase(),
    ).to.equal(longPool.debtToken.toLowerCase());
  });

  it('Should buy the volatile asset when repaying a SHORT', async () => {
    // The reason this combo exists at all: a short's debt is wstETH or WBTC.
    stub0xQuote = stubQuoteBuying(
      shortPool.debtToken,
      shortPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    await comboFor(MINIMUM_BUY, 'stETH-Short').getComboMealOutput(
      comboInput([positionNFT(shortPool.address)]),
    );

    expect(
      stub0xQuote.firstCall.args[0].buyERC20Info.tokenAddress.toLowerCase(),
    ).to.equal(shortPool.debtToken.toLowerCase());
  });

  it('Should never move collateral', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const output = await comboFor(
      MINIMUM_BUY,
      'wstETH-Long',
    ).getComboMealOutput(comboInput([positionNFT(longPool.address)]));

    // Debt axis only. This is what separates a repay from a close, and it is
    // why the position survives whatever the fill turns out to be.
    expect(
      encodedCollateralDelta(output.crossContractCalls, longPool.poolManager),
    ).to.equal(0n);
  });

  it('Should repay from the guaranteed fill, not the expected one', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const output = await comboFor(
      MINIMUM_BUY,
      'wstETH-Long',
    ).getComboMealOutput(comboInput([positionNFT(longPool.address)]));

    expect(
      encodedRepay(output.crossContractCalls, longPool.poolManager),
    ).to.equal(repayFor(MINIMUM_BUY).repayAmount);
  });

  it('Should reject a build sized above the guaranteed fill', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    // Sized against the OPTIMISTIC fill. Fails at build time rather than mining
    // a batch that reshields everything having repaid nothing.
    await expect(
      comboFor(EXPECTED_BUY, 'wstETH-Long').getComboMealOutput(
        comboInput([positionNFT(longPool.address)]),
      ),
    ).to.eventually.be.rejected;
  });

  it('Should shield the position NFT back', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const output = await comboFor(
      MINIMUM_BUY,
      'wstETH-Long',
    ).getComboMealOutput(comboInput([positionNFT(longPool.address)]));

    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
  });

  it('Should refuse a degenerate self-swap, naming the debt side', () => {
    expect(
      () =>
        new ZeroXSwap_FxMintRepay_ComboMeal({
          pool: 'wstETH-Long',
          positionId: POSITION_ID,
          repayAmount: 1n,
          approveAmount: 1n,
          repayFeeRatio: 0n,
          sellERC20Info: {
            tokenAddress: longPool.debtToken,
            decimals: longPool.debtDecimals,
            isBaseToken: false,
          },
          swapSlippageBasisPoints: 100,
          recipient: EXECUTOR,
        }),
    ).to.throw(/already the pool debt/);
  });
});

describe('quoteFxSwapRepay', () => {
  let stub0xQuote: SinonStub;

  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  afterEach(() => {
    stub0xQuote?.restore();
  });

  const params = {
    networkName,
    pool: 'wstETH-Long' as const,
    positionId: POSITION_ID,
    sellERC20Amount: {
      tokenAddress: USDC,
      decimals: 6n,
      amount: 1_000_000_000n,
    },
    swapSlippageBasisPoints: 100,
    recipient: EXECUTOR,
    debt: DEBT,
    repayFeeRatio: 0n,
  };

  it('Should size the repay against the guaranteed fill', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const result = await quoteFxSwapRepay(params);

    expect(result.guaranteedDebtToken).to.equal(MINIMUM_BUY);
    expect(result.expectedDebtToken).to.equal(EXPECTED_BUY);
    expect(result.comboOpts.approveAmount <= MINIMUM_BUY).to.equal(true);
  });

  it('Should not charge an unshield fee on the swapped debt token', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const result = await quoteFxSwapRepay(params);

    // The fee was already taken from the SELL token upstream; this debt token
    // never passes through an unshield. Charging it again under-repays.
    const withUnshieldFee = computeFxRepay({
      debt: DEBT,
      availableDebtToken: MINIMUM_BUY,
      desiredRepayAmount: DEBT,
      repayFeeRatio: 0n,
      railgunUnshieldFeeBps: MOCK_UNSHIELD_FEE_BASIS_POINTS,
    });
    expect(result.comboOpts.repayAmount > withUnshieldFee.repayAmount).to.equal(
      true,
    );
  });

  it('Should report remaining debt rather than implying a close', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const result = await quoteFxSwapRepay(params);

    // A repay never clears the position, only the debt — and here not even all
    // of that, since the fill is half the debt.
    expect(result.clearsDebt).to.equal(false);
    expect(result.remainingDebt).to.equal(DEBT - result.comboOpts.repayAmount);
    expect(result.remainingDebt > 0n).to.equal(true);
  });

  it('Should report clearsDebt when the fill covers the whole debt', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    // Debt below the guaranteed fill. Note this clears the DEBT and leaves the
    // collateral in place — it is not a close.
    const result = await quoteFxSwapRepay({
      ...params,
      debt: 400_000_000_000_000_000n,
    });

    expect(result.clearsDebt).to.equal(true);
    expect(result.remainingDebt).to.equal(0n);
  });

  it('Should honour a desiredRepayAmount cap', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const cap = 100_000_000_000_000_000n;
    const result = await quoteFxSwapRepay({
      ...params,
      desiredRepayAmount: cap,
    });

    expect(result.comboOpts.repayAmount).to.equal(cap);
    expect(result.remainingDebt).to.equal(DEBT - cap);
  });

  it('Should produce options the combo accepts unchanged', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const { comboOpts } = await quoteFxSwapRepay(params);
    const output = await new ZeroXSwap_FxMintRepay_ComboMeal(
      comboOpts,
    ).getComboMealOutput(comboInput([positionNFT(longPool.address)]));

    expect(output.crossContractCalls.length > 0).to.equal(true);
  });

  it('Should refuse when the guaranteed fill buys no repayment at all', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      1n,
      0n,
    );

    await expect(quoteFxSwapRepay(params)).to.eventually.be.rejectedWith(
      /does not cover any repayment/,
    );
  });

  it('Should refuse a sell token that is already the debt token', async () => {
    await expect(
      quoteFxSwapRepay({
        ...params,
        sellERC20Amount: {
          tokenAddress: longPool.debtToken,
          decimals: longPool.debtDecimals,
          amount: 1_000n,
        },
      }),
    ).to.eventually.be.rejectedWith(/already the pool debt token/);
  });
});
