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
  FX_ADDRESSES,
  FX_POOL_MANAGER_ABI,
  resolvePool,
} from '../../../steps/borrow/fx/fx-mint-util';
import { FxMintBorrowMore_ZeroXSwap_ComboMeal } from '../fx-mint-borrow-more-zero-x-swap-combo-meal';
import { FxMintTopupAndBorrow_ZeroXSwap_ComboMeal } from '../fx-mint-topup-and-borrow-zero-x-swap-combo-meal';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const EXECUTOR = '0x1111111111111111111111111111111111111111';
const RELAY_ADAPT = '0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const usdcInfo: RecipeERC20Info = {
  tokenAddress: USDC,
  decimals: 6n,
  isBaseToken: false,
};

const longPool = resolvePool('wstETH-Long');
const shortPool = resolvePool('WBTC-Short');

const POSITION_ID = 1903n;

// Live at block 25688619: PoolConfiguration.getPoolFeeRatio(wstETH-Long,
// DEFAULT_FXMINT_OPERATOR)[2] = 5e6/1e9 = 0.5%. Both shorts read 0 on this axis.
const LONG_BORROW_FEE_RATIO = 5_000_000n;
const SHORT_BORROW_FEE_RATIO = 0n;

// Borrow 1 fxUSD; f(x) mints 0.995 to the executor and 0.005 to its fee
// recipient. Measured on mainnet: tx 0x09a3bd9d…, block 25078146, position 1912.
const ADDITIONAL_DEBT = 1_000_000_000_000_000_000n;
const BORROWED_NET = 995_000_000_000_000_000n;

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

const stubExitQuote = () => stubQuoteBuying(USDC, 6n, 1_500_000n, 1_485_000n);

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

/** `(newColl, newDebt)` from the first operate() aimed at `manager`. */
const decodeOperate = (
  calls: { to?: string; data: string }[],
  manager: string,
): { newColl: bigint; newDebt: bigint } => {
  const iface = new Interface(FX_POOL_MANAGER_ABI);
  for (const call of calls) {
    if (call.to?.toLowerCase() !== manager.toLowerCase()) {
      continue;
    }
    const decoded = iface.decodeFunctionData('operate', call.data);
    return { newColl: decoded[2] as bigint, newDebt: decoded[3] as bigint };
  }
  throw new Error(`no operate() call found targeting ${manager}`);
};

let stub0xQuote: SinonStub;

describe('fx borrow-exit combo meals', () => {
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

  describe('FxMintBorrowMore_ZeroXSwap_ComboMeal', () => {
    const longOpts = {
      pool: 'wstETH-Long' as const,
      positionId: POSITION_ID,
      additionalDebt: ADDITIONAL_DEBT,
      borrowFeeRatio: LONG_BORROW_FEE_RATIO,
      buyERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    };

    it('Should sell the borrowed amount NET of the borrow fee, never the gross', async () => {
      stub0xQuote = stubExitQuote();

      const combo = new FxMintBorrowMore_ZeroXSwap_ComboMeal(longOpts);
      expect(combo.debtTokenToSell).to.equal(BORROWED_NET);

      // No ERC-20 input at all — the position NFT enters alone.
      const output = await combo.getComboMealOutput(
        comboInput([], [positionNFT(longPool.address)]),
      );

      expect(
        decodeOperate(output.crossContractCalls, longPool.poolManager),
      ).to.deep.equal({ newColl: 0n, newDebt: ADDITIONAL_DEBT });

      const quoteParams = stub0xQuote.firstCall.args[0];

      // The whole point. `operate(pool, id, 0, +1e18)` puts 0.995 fxUSD on the
      // executor, not 1.0 — an order for ADDITIONAL_DEBT moves 5e15 fxUSD that
      // does not exist, 0x's transferFrom reverts, and requireSuccess = false
      // mines the batch anyway.
      expect(quoteParams.sellERC20Amount.amount).to.equal(BORROWED_NET);
      expect(quoteParams.sellERC20Amount.amount).to.not.equal(ADDITIONAL_DEBT);

      // Nor is a RAILGUN unshield fee taken off it: this token is minted
      // mid-batch, it never transits an unshield.
      const netOfAnUnshieldFee =
        (BORROWED_NET * (10_000n - MOCK_UNSHIELD_FEE_BASIS_POINTS)) / 10_000n;
      expect(quoteParams.sellERC20Amount.amount > netOfAnUnshieldFee).to.equal(
        true,
        `swap sold ${quoteParams.sellERC20Amount.amount}, at or below the ` +
          `unshield-fee-net ${netOfAnUnshieldFee} — the borrowed token is ` +
          'minted mid-batch and never transits an unshield',
      );

      // Sell side comes off the pool; buy side is the caller's.
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        longPool.debtToken.toLowerCase(),
      );
      expect(quoteParams.buyERC20Info.tokenAddress.toLowerCase()).to.equal(
        USDC.toLowerCase(),
      );
      expect(quoteParams.recipient).to.equal(EXECUTOR);

      expect(
        output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
      ).to.include(USDC.toLowerCase());

      // The handle survives an adjust and comes back exactly once.
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(1n);
      expect(output.nftRecipients[0].nftAddress).to.equal(longPool.address);
    });

    it('Should track borrowFeeRatio rather than coincide with it', async () => {
      // Discriminator for the assertion above. Same pool, same additionalDebt,
      // fee ratio forced to zero — if the sell amount were the gross all along,
      // both rows would read 1e18 and the 995e15 assertion would be vacuous.
      // The live wstETH-Long ratio is 5e6; 0n here is a probe, not a claim.
      stub0xQuote = stubExitQuote();

      const combo = new FxMintBorrowMore_ZeroXSwap_ComboMeal({
        ...longOpts,
        borrowFeeRatio: 0n,
      });
      expect(combo.debtTokenToSell).to.equal(ADDITIONAL_DEBT);

      await combo.getComboMealOutput(
        comboInput([], [positionNFT(longPool.address)]),
      );

      expect(stub0xQuote.firstCall.args[0].sellERC20Amount.amount).to.equal(
        ADDITIONAL_DEBT,
      );
    });

    it('Should sell the pool DEBT token on a short — 8-decimal WBTC, not the fxUSD collateral', async () => {
      stub0xQuote = stubExitQuote();

      // 0.001 WBTC, in the debt token's own 8 decimals. Shorts charge nothing on
      // the debt axis, so here net == gross; the assertion that bites is WHICH
      // token is sold. Sizing this leg off the collateral would sell fxUSD.
      const borrowWBTC = 100_000n;
      const combo = new FxMintBorrowMore_ZeroXSwap_ComboMeal({
        pool: 'WBTC-Short',
        positionId: POSITION_ID,
        additionalDebt: borrowWBTC,
        borrowFeeRatio: SHORT_BORROW_FEE_RATIO,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });
      expect(combo.debtTokenToSell).to.equal(borrowWBTC);

      const output = await combo.getComboMealOutput(
        comboInput([], [positionNFT(shortPool.address)]),
      );

      const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
      expect(targets).to.include(FX_ADDRESSES.fxShortPoolManager.toLowerCase());
      expect(targets).to.not.include(FX_ADDRESSES.fxPoolManager.toLowerCase());

      const quoteParams = stub0xQuote.firstCall.args[0];
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        shortPool.debtToken.toLowerCase(),
      );
      expect(
        quoteParams.sellERC20Amount.tokenAddress.toLowerCase(),
      ).to.not.equal(shortPool.collateralToken.toLowerCase());
      expect(quoteParams.sellERC20Amount.decimals).to.equal(8n);
      expect(quoteParams.sellERC20Amount.amount).to.equal(borrowWBTC);
    });

    it('Should allow buying back the pool collateral (a lever-up, not a self-swap)', async () => {
      stub0xQuote = stubQuoteBuying(
        longPool.collateralToken,
        longPool.collateralDecimals,
        500_000_000_000_000_000n,
        495_000_000_000_000_000n,
      );

      const combo = new FxMintBorrowMore_ZeroXSwap_ComboMeal({
        ...longOpts,
        buyERC20Info: {
          tokenAddress: longPool.collateralToken,
          decimals: longPool.collateralDecimals,
          isBaseToken: false,
        },
      });

      const output = await combo.getComboMealOutput(
        comboInput([], [positionNFT(longPool.address)]),
      );

      // The bought collateral shields back — it is NOT re-deposited, so there
      // must be exactly one operate() and it must still be the debt-only one.
      const operateCalls = output.crossContractCalls.filter(
        c => c.to?.toLowerCase() === longPool.poolManager.toLowerCase(),
      );
      expect(operateCalls).to.have.length(1);
      expect(
        output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
      ).to.include(longPool.collateralToken.toLowerCase());
    });

    it('Should reject a buy token that is already the pool debt token', () => {
      // Must name the DEBT side. On a short the collateral and debt tokens are
      // each other's opposite, so "already the pool collateral" would send the
      // caller to the wrong argument.
      expect(
        () =>
          new FxMintBorrowMore_ZeroXSwap_ComboMeal({
            ...longOpts,
            buyERC20Info: {
              tokenAddress: longPool.debtToken,
              decimals: longPool.debtDecimals,
              isBaseToken: false,
            },
          }),
      ).to.throw(/buy token is already the pool debt/);
    });

    it('Should reject the relay-adapt contract as the executor', () => {
      expect(
        () =>
          new FxMintBorrowMore_ZeroXSwap_ComboMeal({
            ...longOpts,
            recipient: RELAY_ADAPT,
          }),
      ).to.throw(/ephemeral EOA, not the shared relay-adapt/);
    });

    it('Should surface the recipe guard on a non-positive additionalDebt', () => {
      // The combo must not swallow this into a "no ERC20 amount" error from the
      // swap leg: it is the recipe's constraint and the recipe's message.
      expect(
        () =>
          new FxMintBorrowMore_ZeroXSwap_ComboMeal({
            ...longOpts,
            additionalDebt: 0n,
          }),
      ).to.throw(/additionalDebt must be > 0/);
    });

    it('Should reject a borrowFeeRatio that is not 1e9-denominated at the top of the range', () => {
      expect(
        () =>
          new FxMintBorrowMore_ZeroXSwap_ComboMeal({
            ...longOpts,
            borrowFeeRatio: 1_000_000_000n,
          }),
      ).to.throw(/borrowFeeRatio 1000000000 is outside/);
    });
  });

  describe('FxMintTopupAndBorrow_ZeroXSwap_ComboMeal', () => {
    const TOPUP_COLLATERAL = 400_000_000_000_000_000n; // 0.4 wstETH shielded
    const TOPUP_AFTER_UNSHIELD_FEE =
      TOPUP_COLLATERAL -
      (TOPUP_COLLATERAL * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10_000n;

    const collateralInput = (amount = TOPUP_COLLATERAL) => [
      {
        tokenAddress: longPool.collateralToken,
        decimals: longPool.collateralDecimals,
        isBaseToken: false,
        amount,
      },
    ];

    const longOpts = {
      pool: 'wstETH-Long' as const,
      positionId: POSITION_ID,
      additionalDebt: ADDITIONAL_DEBT,
      borrowFeeRatio: LONG_BORROW_FEE_RATIO,
      buyERC20Info: usdcInfo,
      swapSlippageBasisPoints: 100,
      recipient: EXECUTOR,
    };

    it('Should deposit the unshielded collateral and sell only the fee-net borrowing', async () => {
      stub0xQuote = stubExitQuote();

      const combo = new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal(longOpts);
      expect(combo.debtTokenToSell).to.equal(BORROWED_NET);

      const output = await combo.getComboMealOutput(
        comboInput(collateralInput(), [positionNFT(longPool.address)]),
      );

      // One operate() carrying BOTH legs — that single call is what makes
      // lever-up cheaper than topup followed by borrow.
      const { newColl, newDebt } = decodeOperate(
        output.crossContractCalls,
        longPool.poolManager,
      );
      expect(newColl).to.equal(TOPUP_AFTER_UNSHIELD_FEE);
      expect(newDebt).to.equal(ADDITIONAL_DEBT);

      const quoteParams = stub0xQuote.firstCall.args[0];

      // The swap sells the borrowed debt token, fee-net — not the gross, and
      // not the collateral it just deposited.
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        longPool.debtToken.toLowerCase(),
      );
      expect(quoteParams.sellERC20Amount.amount).to.equal(BORROWED_NET);
      expect(quoteParams.sellERC20Amount.amount).to.not.equal(ADDITIONAL_DEBT);
      expect(quoteParams.sellERC20Amount.amount).to.not.equal(
        TOPUP_AFTER_UNSHIELD_FEE,
      );

      expect(
        output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
      ).to.include(USDC.toLowerCase());
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(1n);
    });

    it('Should leave no collateral for the swap leg to touch', async () => {
      stub0xQuote = stubExitQuote();

      const combo = new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal(longOpts);
      const output = await combo.getComboMealOutput(
        comboInput(collateralInput(), [positionNFT(longPool.address)]),
      );

      // operate() consumes the whole deposit, so the seam carries only the
      // borrowing. A surplus here would mean the clamp bit on a deterministic
      // input, which would also mean the combo under-deposited.
      const collateralSpends = output.stepOutputs
        .flatMap(s => s.spentERC20Amounts ?? [])
        .filter(
          a =>
            a.tokenAddress.toLowerCase() ===
            longPool.collateralToken.toLowerCase(),
        );
      expect(collateralSpends).to.have.length(1);
      expect(collateralSpends[0].amount).to.equal(TOPUP_AFTER_UNSHIELD_FEE);

      expect(stub0xQuote.callCount).to.equal(1);
    });

    it('Should allow buying the pool collateral — the leverage-loop case', () => {
      // The guard sits on the DEBT side here. Rejecting a collateral buy would
      // block the one composition this combo is most useful for.
      expect(
        () =>
          new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal({
            ...longOpts,
            buyERC20Info: {
              tokenAddress: longPool.collateralToken,
              decimals: longPool.collateralDecimals,
              isBaseToken: false,
            },
          }),
      ).to.not.throw();
    });

    it('Should reject a buy token that is already the pool debt token', () => {
      expect(
        () =>
          new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal({
            ...longOpts,
            buyERC20Info: {
              tokenAddress: longPool.debtToken,
              decimals: longPool.debtDecimals,
              isBaseToken: false,
            },
          }),
      ).to.throw(/buy token is already the pool debt/);
    });

    it('Should reject the relay-adapt contract as the executor', () => {
      expect(
        () =>
          new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal({
            ...longOpts,
            recipient: RELAY_ADAPT,
          }),
      ).to.throw(/ephemeral EOA, not the shared relay-adapt/);
    });

    it('Should surface the recipe guard on a non-positive additionalDebt', () => {
      expect(
        () =>
          new FxMintTopupAndBorrow_ZeroXSwap_ComboMeal({
            ...longOpts,
            additionalDebt: 0n,
          }),
      ).to.throw(/additionalDebt must be > 0/);
    });
  });
});
