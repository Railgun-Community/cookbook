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
import { ZeroXSwap_FxMintOpen_ComboMeal } from '../zero-x-swap-fx-mint-open-combo-meal';
import { ZeroXSwap_FxMintTopup_ComboMeal } from '../zero-x-swap-fx-mint-topup-combo-meal';
import { ZeroXSwap_FxMintTopupAndBorrow_ComboMeal } from '../zero-x-swap-fx-mint-topup-and-borrow-combo-meal';
import { FxMintClose_ZeroXSwap_ComboMeal } from '../fx-mint-close-zero-x-swap-combo-meal';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const EXECUTOR = '0x1111111111111111111111111111111111111111';
// The shared relay-adapt contract — must be rejected as an executor.
const RELAY_ADAPT = '0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405';

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const usdcInfo: RecipeERC20Info = {
  tokenAddress: USDC,
  decimals: 6n,
  isBaseToken: false,
};

const wstETHPool = resolvePool('wstETH-Long');
const POSITION_ID = 1903n;
const ADDITIONAL_DEBT = 1_000_000_000_000_000_000n;

// Deliberate spread between the optimistic quote and the guaranteed floor:
// every deposit-side assertion below turns on which of these reaches the wire.
const EXPECTED_BUY = 500_000_000_000_000_000n;
const MINIMUM_BUY = 495_000_000_000_000_000n;

/**
 * Stub `ZeroXV2Quote.getSwapQuote` the way the real API behaves: the quote is
 * built for the amount actually requested. Hardcoding `sellTokenValue` would
 * make the swap step reject its own input whenever the recipe asks for the
 * post-unshield-fee balance — which is precisely the caller-guessed-amount
 * failure mode this refactor removes.
 */
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

const usdcInput = (amount = 1_000_000n) => [
  { tokenAddress: USDC, decimals: 6n, isBaseToken: false, amount },
];

/**
 * Collateral amount encoded into the first PoolManager.operate() call.
 *
 * `manager` defaults to the long manager. Short pools are registered on a
 * different one, so it has to be a parameter — the same 4-arg `operate`
 * fragment decodes both.
 */
const encodedCollateral = (
  calls: { to?: string; data: string }[],
  manager: string = FX_ADDRESSES.fxPoolManager,
): bigint => {
  const iface = new Interface(FX_POOL_MANAGER_ABI);
  for (const call of calls) {
    if (call.to?.toLowerCase() !== manager.toLowerCase()) {
      continue;
    }
    const decoded = iface.decodeFunctionData('operate', call.data);
    return decoded[2] as bigint;
  }
  throw new Error(`no operate() call found targeting ${manager}`);
};

let stub0xQuote: SinonStub;

describe('fx combo meals', () => {
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

  describe('ZeroXSwap_FxMintOpen_ComboMeal', () => {
    it('Should swap any token into the pool collateral and open at the guaranteed minimum', async () => {
      stub0xQuote = stubQuoteBuying(
        wstETHPool.collateralToken,
        wstETHPool.collateralDecimals,
        EXPECTED_BUY,
        MINIMUM_BUY,
      );

      const combo = new ZeroXSwap_FxMintOpen_ComboMeal({
        pool: 'wstETH-Long',
        targetDebt: 5_000_000_000_000_000_000n,
        predictedPositionId: POSITION_ID,
        borrowFeeRatio: 5_000_000n,
        sellERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(comboInput(usdcInput()));

      // The buy side is derived from the pool, not supplied by the caller.
      const quoteParams = stub0xQuote.firstCall.args[0];
      expect(quoteParams.buyERC20Info.tokenAddress.toLowerCase()).to.equal(
        wstETHPool.collateralToken.toLowerCase(),
      );
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        USDC.toLowerCase(),
      );
      expect(quoteParams.recipient).to.equal(EXECUTOR);

      // The conservative seam + the step-level clamp put minimumBuyAmount on
      // the wire, never the optimistic quote. This is the whole point.
      expect(encodedCollateral(output.crossContractCalls)).to.equal(
        MINIMUM_BUY,
      );

      // fxUSD and the position NFT come back shielded.
      expect(
        output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
      ).to.include(FX_ADDRESSES.fxUSD.toLowerCase());
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(1n);
    });

    it('Should reject the relay-adapt contract as the executor', () => {
      expect(
        () =>
          new ZeroXSwap_FxMintOpen_ComboMeal({
            pool: 'wstETH-Long',
            targetDebt: 1_000_000_000_000_000_000n,
            predictedPositionId: POSITION_ID,
            borrowFeeRatio: 0n,
            sellERC20Info: usdcInfo,
            swapSlippageBasisPoints: 100,
            recipient: RELAY_ADAPT,
          }),
      ).to.throw(/ephemeral EOA, not the shared relay-adapt/);
    });

    it('Should reject a sell token that is already the pool collateral', () => {
      expect(
        () =>
          new ZeroXSwap_FxMintOpen_ComboMeal({
            pool: 'wstETH-Long',
            targetDebt: 1_000_000_000_000_000_000n,
            predictedPositionId: POSITION_ID,
            borrowFeeRatio: 0n,
            sellERC20Info: {
              tokenAddress: wstETHPool.collateralToken,
              decimals: 18n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            recipient: EXECUTOR,
          }),
      ).to.throw(/already the pool collateral/);
    });
  });

  describe('ZeroXSwap_FxMintTopup_ComboMeal', () => {
    it('Should carry the position NFT across the swap seam', async () => {
      stub0xQuote = stubQuoteBuying(
        wstETHPool.collateralToken,
        wstETHPool.collateralDecimals,
        EXPECTED_BUY,
        MINIMUM_BUY,
      );

      const combo = new ZeroXSwap_FxMintTopup_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        sellERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(
        comboInput(usdcInput(), [positionNFT(wstETHPool.address)]),
      );

      // Exactly one NFT entry at amount 1n — the aggregation defect fixed in
      // phase 001 would have produced 2n here.
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(1n);
      expect(output.nftRecipients[0].nftAddress).to.equal(wstETHPool.address);

      expect(encodedCollateral(output.crossContractCalls)).to.equal(
        MINIMUM_BUY,
      );
    });
  });

  describe('ZeroXSwap_FxMintTopupAndBorrow_ComboMeal', () => {
    it('Should output the post-borrow-fee fxUSD and keep the NFT', async () => {
      stub0xQuote = stubQuoteBuying(
        wstETHPool.collateralToken,
        wstETHPool.collateralDecimals,
        EXPECTED_BUY,
        MINIMUM_BUY,
      );

      const combo = new ZeroXSwap_FxMintTopupAndBorrow_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        additionalDebt: ADDITIONAL_DEBT,
        borrowFeeRatio: 5_000_000n, // 0.5%
        sellERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(
        comboInput(usdcInput(), [positionNFT(wstETHPool.address)]),
      );

      const fxUSDOut = output.erc20AmountRecipients.find(
        r => r.tokenAddress.toLowerCase() === FX_ADDRESSES.fxUSD.toLowerCase(),
      );
      if (!fxUSDOut) {
        throw new Error('expected fxUSD in erc20AmountRecipients');
      }
      expect(fxUSDOut.amount > 0n).to.equal(true);
      expect(fxUSDOut.amount < ADDITIONAL_DEBT).to.equal(true);

      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].amount).to.equal(1n);
    });
  });

  describe('FxMintClose_ZeroXSwap_ComboMeal', () => {
    const REPAY_AMOUNT = 1_000_000_000_000_000_000n;
    const APPROVE_AMOUNT = 1_005_000_000_000_000_000n;
    const WITHDRAW_COLL = 500_000_000_000_000_000n;

    const fxUSDInput = (amount = 2_000_000_000_000_000_000n) => [
      {
        tokenAddress: FX_ADDRESSES.fxUSD,
        decimals: 18n,
        isBaseToken: false,
        amount,
      },
    ];

    const stubExitQuote = () =>
      stubQuoteBuying(USDC, 6n, 1_500_000n, 1_485_000n);

    it('Should sell the withdrawn collateral into an arbitrary token', async () => {
      stub0xQuote = stubExitQuote();

      const combo = new FxMintClose_ZeroXSwap_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        repayAmount: REPAY_AMOUNT,
        withdrawColl: WITHDRAW_COLL,
        approveAmount: APPROVE_AMOUNT,
        withdrawFeeRatio: 0n, // long pool
        partialClose: true,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(
        comboInput(fxUSDInput(), [positionNFT(wstETHPool.address)]),
      );

      // The sell side is derived from the pool — the swap can only ever sell
      // what the close actually withdraws.
      const quoteParams = stub0xQuote.firstCall.args[0];
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        wstETHPool.collateralToken.toLowerCase(),
      );
      expect(quoteParams.buyERC20Info.tokenAddress.toLowerCase()).to.equal(
        USDC.toLowerCase(),
      );

      expect(
        output.erc20AmountRecipients.map(r => r.tokenAddress.toLowerCase()),
      ).to.include(USDC.toLowerCase());
    });

    it('Should keep the NFT on a partial close and burn it on a full close', async () => {
      stub0xQuote = stubExitQuote();

      const partial = new FxMintClose_ZeroXSwap_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        repayAmount: REPAY_AMOUNT,
        withdrawColl: WITHDRAW_COLL,
        approveAmount: APPROVE_AMOUNT,
        withdrawFeeRatio: 0n, // long pool
        partialClose: true,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });
      const partialOut = await partial.getComboMealOutput(
        comboInput(fxUSDInput(), [positionNFT(wstETHPool.address)]),
      );
      expect(partialOut.nftRecipients).to.have.length(1);
      expect(partialOut.nftRecipients[0].amount).to.equal(1n);

      const full = new FxMintClose_ZeroXSwap_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        repayAmount: REPAY_AMOUNT,
        withdrawColl: WITHDRAW_COLL,
        approveAmount: APPROVE_AMOUNT,
        withdrawFeeRatio: 0n, // long pool
        partialClose: false,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });
      const fullOut = await full.getComboMealOutput(
        comboInput(fxUSDInput(), [positionNFT(wstETHPool.address)]),
      );
      expect(fullOut.nftRecipients).to.have.length(1);
      expect(fullOut.nftRecipients[0].amount).to.equal(0n);
    });

    it('Should reshield the unspent fxUSD orphaned by the close', async () => {
      stub0xQuote = stubExitQuote();

      const combo = new FxMintClose_ZeroXSwap_ComboMeal({
        pool: 'wstETH-Long',
        positionId: POSITION_ID,
        repayAmount: REPAY_AMOUNT,
        withdrawColl: WITHDRAW_COLL,
        approveAmount: APPROVE_AMOUNT,
        withdrawFeeRatio: 0n, // long pool
        partialClose: true,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      // Unshield more fxUSD than the close consumes; the remainder is not the
      // swap's business and must come back to the user.
      const output = await combo.getComboMealOutput(
        comboInput(fxUSDInput(3_000_000_000_000_000_000n), [
          positionNFT(wstETHPool.address),
        ]),
      );

      const fxUSDBack = output.erc20AmountRecipients.find(
        r => r.tokenAddress.toLowerCase() === FX_ADDRESSES.fxUSD.toLowerCase(),
      );
      if (!fxUSDBack) {
        throw new Error('expected unspent fxUSD to reshield');
      }
      expect(fxUSDBack.amount > 0n).to.equal(true);
    });

    it('Should reject the relay-adapt contract as the executor', () => {
      expect(
        () =>
          new FxMintClose_ZeroXSwap_ComboMeal({
            pool: 'wstETH-Long',
            positionId: POSITION_ID,
            repayAmount: REPAY_AMOUNT,
            withdrawColl: WITHDRAW_COLL,
            approveAmount: APPROVE_AMOUNT,
            withdrawFeeRatio: 0n, // long pool
            partialClose: true,
            buyERC20Info: usdcInfo,
            swapSlippageBasisPoints: 100,
            recipient: RELAY_ADAPT,
          }),
      ).to.throw(/ephemeral EOA, not the shared relay-adapt/);
    });

    it('Should reject a buy token that is already the pool collateral', () => {
      // Exit-side mirror of the deposit guard. The error must name the *buy*
      // side — that is the argument the caller supplied on this combo.
      expect(
        () =>
          new FxMintClose_ZeroXSwap_ComboMeal({
            pool: 'wstETH-Long',
            positionId: POSITION_ID,
            repayAmount: REPAY_AMOUNT,
            withdrawColl: WITHDRAW_COLL,
            approveAmount: APPROVE_AMOUNT,
            withdrawFeeRatio: 0n, // long pool
            partialClose: true,
            buyERC20Info: {
              tokenAddress: wstETHPool.collateralToken,
              decimals: 18n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            recipient: EXECUTOR,
          }),
      ).to.throw(/buy token is already the pool collateral/);
    });
  });

  describe('short pools (f(x) v2.1)', () => {
    const shortPool = resolvePool('stETH-Short');

    it('open: swaps into fxUSD and routes operate() to the short manager', async () => {
      // For a short the BUY side of the swap is fxUSD — the mirror of a long,
      // where it is wstETH/WBTC.
      stub0xQuote = stubQuoteBuying(
        shortPool.collateralToken,
        18n,
        EXPECTED_BUY,
        MINIMUM_BUY,
      );

      const combo = new ZeroXSwap_FxMintOpen_ComboMeal({
        pool: 'stETH-Short',
        targetDebt: 100_000_000_000_000_000n, // borrow 0.1 wstETH
        predictedPositionId: 171n,
        borrowFeeRatio: 0n,
        sellERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(comboInput(usdcInput()));

      const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
      expect(targets).to.include(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );
      expect(targets).to.not.include(FX_ADDRESSES.fxPoolManager.toLowerCase());

      // Same conservative-seam behaviour as a long: the GUARANTEED minimum is
      // encoded, not the optimistic quote, so an underfill cannot revert the
      // batch.
      expect(
        encodedCollateral(
          output.crossContractCalls,
          FX_ADDRESSES.fxShortPoolManager,
        ),
      ).to.equal(MINIMUM_BUY);

      // The borrowed wstETH and the position NFT shield back.
      const shielded = output.erc20AmountRecipients.map(r =>
        r.tokenAddress.toLowerCase(),
      );
      expect(shielded).to.include(FX_ADDRESSES.wstETH.toLowerCase());
      expect(output.nftRecipients).to.have.length(1);
      expect(output.nftRecipients[0].nftAddress).to.equal(shortPool.address);
    });

    it('open: rejects fxUSD as the sell token on a short (it is the collateral)', () => {
      // The guard has to follow the pool, not a hardcoded token: fxUSD is a
      // perfectly valid sell token for a LONG and a self-swap for a short.
      expect(
        () =>
          new ZeroXSwap_FxMintOpen_ComboMeal({
            pool: 'stETH-Short',
            targetDebt: 100_000_000_000_000_000n,
            predictedPositionId: 171n,
            borrowFeeRatio: 0n,
            sellERC20Info: {
              tokenAddress: FX_ADDRESSES.fxUSD,
              decimals: 18n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            recipient: EXECUTOR,
          }),
      ).to.throw(/sell token is already the pool collateral/);
    });

    it('close: sells the withdrawn fxUSD and honours withdrawFeeRatio', async () => {
      stub0xQuote = stubQuoteBuying(USDC, 6n, 1_000_000n, 995_000n);

      const withdrawGross = 1_000_000_000_000_000_000_000n; // 1000 fxUSD
      const combo = new FxMintClose_ZeroXSwap_ComboMeal({
        pool: 'stETH-Short',
        positionId: POSITION_ID,
        repayAmount: 100_000_000_000_000_000n, // 0.1 wstETH
        approveAmount: 100_000_000_000_000_000n, // zero repay fee on shorts
        withdrawColl: withdrawGross,
        withdrawFeeRatio: 1_000_000n, // 0.1%
        partialClose: true,
        buyERC20Info: usdcInfo,
        swapSlippageBasisPoints: 100,
        recipient: EXECUTOR,
      });

      const output = await combo.getComboMealOutput(
        comboInput(
          [
            {
              tokenAddress: shortPool.debtToken,
              decimals: 18n,
              isBaseToken: false,
              amount: 200_000_000_000_000_000n,
            },
          ],
          [positionNFT(shortPool.address)],
        ),
      );

      const targets = output.crossContractCalls.map(c => c.to?.toLowerCase());
      expect(targets).to.include(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );

      // The swap sells fxUSD net of the withdraw fee. If the combo sold the
      // gross it would try to move 1 fxUSD it never received.
      const swapSell = output.stepOutputs
        .flatMap(s => s.spentERC20Amounts ?? [])
        .filter(
          a =>
            a.tokenAddress.toLowerCase() ===
            shortPool.collateralToken.toLowerCase(),
        );
      expect(swapSell.length).to.be.greaterThan(0);
      for (const sell of swapSell) {
        expect(sell.amount <= 999_000_000_000_000_000_000n).to.equal(
          true,
          `swap must sell at most the fee-net 999 fxUSD, got ${sell.amount}`,
        );
      }

      // USDC comes out; the NFT survives a partial close.
      const shielded = output.erc20AmountRecipients.map(r =>
        r.tokenAddress.toLowerCase(),
      );
      expect(shielded).to.include(USDC.toLowerCase());
      expect(output.nftRecipients[0].amount).to.equal(1n);
    });
  });
});
