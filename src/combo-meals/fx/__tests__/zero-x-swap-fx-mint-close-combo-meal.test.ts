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
  computeFxClose,
  resolvePool,
} from '../../../steps/borrow/fx/fx-mint-util';
import { ZeroXSwap_FxMintClose_ComboMeal } from '../zero-x-swap-fx-mint-close-combo-meal';
import { quoteFxSwapClose } from '../quote-fx-swap-close';

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

// A deliberate spread: every sizing assertion below turns on which of these the
// close is built against.
const EXPECTED_BUY = 500_000_000_000_000_000n;
const MINIMUM_BUY = 495_000_000_000_000_000n;

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
        spender: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
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

const comboInput = (
  erc20Amounts: RecipeInput['erc20Amounts'],
  nfts: RecipeInput['nfts'] = [],
): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts,
  nfts,
});

const usdcInput = (amount = 1_000_000_000n) => [
  { tokenAddress: USDC, decimals: 6n, isBaseToken: false, amount },
];

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

describe('ZeroXSwap_FxMintClose_ComboMeal', () => {
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

  /**
   * Debt deliberately LARGER than either fill. If the debt is below both, the
   * repay caps at the debt and an optimistic sizing is indistinguishable from a
   * conservative one — which would make the rejection test below vacuous.
   */
  const closeOptsFor = (available: bigint) =>
    computeFxClose({
      collateral: 1_000_000_000_000_000_000n,
      debt: 1_000_000_000_000_000_000n,
      availableDebtToken: available,
      repayFeeRatio: 0n,
      withdrawFeeRatio: 0n,
      railgunUnshieldFeeBps: 0n,
    });

  it('Should buy the pool debt token, derived from the pool', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );
    const amounts = closeOptsFor(MINIMUM_BUY);

    const combo = new ZeroXSwap_FxMintClose_ComboMeal({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: amounts.repayAmount,
      withdrawColl: amounts.withdrawColl,
      approveAmount: amounts.approveAmount,
      withdrawFeeRatio: 0n,
      partialClose: amounts.partialClose,
      sellERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    await combo.getComboMealOutput(
      comboInput(usdcInput(), [positionNFT(longPool.address)]),
    );

    // The buy side is never caller-supplied: a debt is repayable only in the
    // debt token, so a quote naming anything else builds a batch operate()
    // refuses.
    const quoteParams = stub0xQuote.firstCall.args[0];
    expect(quoteParams.buyERC20Info.tokenAddress.toLowerCase()).to.equal(
      longPool.debtToken.toLowerCase(),
    );
    expect(quoteParams.recipient).to.equal(EXECUTOR);
  });

  it('Should buy the volatile asset when closing a SHORT', async () => {
    // The case that blocked the action outright: a short's debt is wstETH or
    // WBTC, which the holder of a stablecoin does not have.
    stub0xQuote = stubQuoteBuying(
      shortPool.debtToken,
      shortPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );
    const amounts = closeOptsFor(MINIMUM_BUY);

    const combo = new ZeroXSwap_FxMintClose_ComboMeal({
      pool: 'stETH-Short',
      positionId: POSITION_ID,
      repayAmount: amounts.repayAmount,
      withdrawColl: amounts.withdrawColl,
      approveAmount: amounts.approveAmount,
      withdrawFeeRatio: 1_000_000n,
      partialClose: amounts.partialClose,
      sellERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    await combo.getComboMealOutput(
      comboInput(usdcInput(), [positionNFT(shortPool.address)]),
    );

    expect(
      stub0xQuote.firstCall.args[0].buyERC20Info.tokenAddress.toLowerCase(),
    ).to.equal(shortPool.debtToken.toLowerCase());
    // Short and long debt tokens are genuinely different assets — if this ever
    // matches the long's, the pool descriptor is not being read.
    expect(shortPool.debtToken.toLowerCase()).to.not.equal(
      longPool.debtToken.toLowerCase(),
    );
  });

  it('Should repay from the guaranteed fill, not the expected one', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );
    const amounts = closeOptsFor(MINIMUM_BUY);

    const combo = new ZeroXSwap_FxMintClose_ComboMeal({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: amounts.repayAmount,
      withdrawColl: amounts.withdrawColl,
      approveAmount: amounts.approveAmount,
      withdrawFeeRatio: 0n,
      partialClose: amounts.partialClose,
      sellERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    const output = await combo.getComboMealOutput(
      comboInput(usdcInput(), [positionNFT(longPool.address)]),
    );

    // The seam is conservative, so the close sees MINIMUM_BUY. Sizing against
    // EXPECTED_BUY would revert operate() on any merely-average fill — and
    // under requireSuccess = false that reverts silently, mining a batch that
    // did nothing at full gas cost.
    expect(encodedRepay(output.crossContractCalls, longPool.poolManager)).to.equal(
      amounts.repayAmount,
    );
    expect(amounts.repayAmount <= MINIMUM_BUY).to.equal(true);
  });

  it('Should reject a build sized above the guaranteed fill', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );
    // Sized against the OPTIMISTIC number — the mistake this combo exists to
    // make impossible to ship.
    const optimistic = closeOptsFor(EXPECTED_BUY);

    const combo = new ZeroXSwap_FxMintClose_ComboMeal({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: optimistic.repayAmount,
      withdrawColl: optimistic.withdrawColl,
      approveAmount: optimistic.approveAmount,
      withdrawFeeRatio: 0n,
      partialClose: optimistic.partialClose,
      sellERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    // Fails at BUILD time rather than on chain. That is the good outcome.
    await expect(
      combo.getComboMealOutput(
        comboInput(usdcInput(), [positionNFT(longPool.address)]),
      ),
    ).to.eventually.be.rejected;
  });

  it('Should shield the position NFT back through both legs', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );
    const amounts = closeOptsFor(MINIMUM_BUY);

    const combo = new ZeroXSwap_FxMintClose_ComboMeal({
      pool: 'wstETH-Long',
      positionId: POSITION_ID,
      repayAmount: amounts.repayAmount,
      withdrawColl: amounts.withdrawColl,
      approveAmount: amounts.approveAmount,
      withdrawFeeRatio: 0n,
      partialClose: amounts.partialClose,
      sellERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    });

    const output = await combo.getComboMealOutput(
      comboInput(usdcInput(), [positionNFT(longPool.address)]),
    );

    // The NFT enters as combo input, transits the swap leg untouched, and comes
    // back. f(x) does not burn on close, so this holds on a full close too.
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
    expect(output.nftRecipients[0].nftAddress.toLowerCase()).to.equal(
      longPool.address.toLowerCase(),
    );
  });

  it('Should refuse a degenerate self-swap, naming the debt side', () => {
    const debtAsSell: RecipeERC20Info = {
      tokenAddress: longPool.debtToken,
      decimals: longPool.debtDecimals,
      isBaseToken: false,
    };

    expect(
      () =>
        new ZeroXSwap_FxMintClose_ComboMeal({
          pool: 'wstETH-Long',
          positionId: POSITION_ID,
          repayAmount: 1n,
          withdrawColl: 1n,
          approveAmount: 1n,
          withdrawFeeRatio: 0n,
          partialClose: true,
          sellERC20Info: debtAsSell,
          swapSlippageBasisPoints: 100,
          recipient: EXECUTOR,
        }),
      // "collateral" would be actively misleading here: on a short the two are
      // each other's opposite.
    ).to.throw(/already the pool debt/);
  });
});

describe('quoteFxSwapClose', () => {
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
    collateral: 1_000_000_000_000_000_000n,
    // Above both fills, so repay tracks what the swap delivers rather than
    // capping at the debt. The full-close case overrides this.
    debt: 1_000_000_000_000_000_000n,
    repayFeeRatio: 0n,
    withdrawFeeRatio: 0n,
  };

  it('Should size the close against the guaranteed fill', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const result = await quoteFxSwapClose(params);

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

    const result = await quoteFxSwapClose(params);

    // The fee was already taken from the SELL token upstream; this debt token
    // never passes through an unshield. Charging it again is safe but silently
    // leaves debt outstanding on what the caller asked to be a full close.
    const withUnshieldFee = computeFxClose({
      collateral: params.collateral,
      // Same debt as the helper used — above the fill, so both sizings track
      // the available amount and the fee difference is visible.
      debt: params.debt,
      availableDebtToken: MINIMUM_BUY,
      repayFeeRatio: 0n,
      withdrawFeeRatio: 0n,
      railgunUnshieldFeeBps: MOCK_UNSHIELD_FEE_BASIS_POINTS,
    });
    expect(result.comboOpts.repayAmount > withUnshieldFee.repayAmount).to.equal(
      true,
    );
  });

  it('Should report a full close as such when the fill covers the debt', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    // Debt below the guaranteed fill, so it is retired outright.
    const debt = 400_000_000_000_000_000n;
    const result = await quoteFxSwapClose({ ...params, debt });

    expect(result.closesFully).to.equal(true);
    expect(result.comboOpts.partialClose).to.equal(false);
    expect(result.comboOpts.repayAmount).to.equal(debt);
  });

  it('Should report a partial close when the fill falls short', async () => {
    const short = 100_000_000_000_000_000n; // a quarter of the debt
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      short + 5_000_000_000_000_000n,
      short,
    );

    const result = await quoteFxSwapClose(params);

    expect(result.closesFully).to.equal(false);
    expect(result.comboOpts.partialClose).to.equal(true);
    expect(result.comboOpts.repayAmount < params.debt).to.equal(true);
  });

  it('Should produce options the combo accepts unchanged', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    const { comboOpts } = await quoteFxSwapClose(params);
    stub0xQuote.restore();
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      EXPECTED_BUY,
      MINIMUM_BUY,
    );

    // The whole point of the helper: hand its output straight to the combo.
    const combo = new ZeroXSwap_FxMintClose_ComboMeal(comboOpts);
    const output = await combo.getComboMealOutput(
      comboInput(usdcInput(), [positionNFT(longPool.address)]),
    );

    expect(output.crossContractCalls.length > 0).to.equal(true);
  });

  it('Should refuse when the guaranteed fill buys no repayment at all', async () => {
    stub0xQuote = stubQuoteBuying(
      longPool.debtToken,
      longPool.debtDecimals,
      1n,
      0n,
    );

    await expect(quoteFxSwapClose(params)).to.eventually.be.rejectedWith(
      /does not cover any repayment/,
    );
  });

  it('Should refuse a sell token that is already the debt token', async () => {
    await expect(
      quoteFxSwapClose({
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
