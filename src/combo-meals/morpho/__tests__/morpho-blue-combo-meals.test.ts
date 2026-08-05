import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  Block,
  Interface,
  InterfaceAbi,
  Provider,
  TransactionRequest,
  getAddress,
} from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import Sinon, { SinonStub } from 'sinon';
import { abi } from '../../../abi/abi';
import {
  RecipeERC20Info,
  RecipeInput,
  type SwapQuoteDataV2,
  type SwapQuoteParamsV2,
} from '../../../models/export-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { ZeroXV2Quote } from '../../../api/zero-x-v2/zero-x-v2-quote';
import { MorphoBluePosition } from '../../../contract/morpho/morpho-blue-contract';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
  borrowAssetsForShares,
  computeMorphoBlueRisk,
} from '../../../steps/morpho/morpho-blue-util';
import { MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW } from '../../../models/min-gas-limits';
import {
  MORPHO_BLUE_BORROW_ROUNDING_UNIT,
  morphoBlueBorrowCeiling,
} from '../util';
import { ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal } from '../zero-x-swap-morpho-blue-supply-collateral-and-borrow-combo-meal';
import { quoteMorphoBlueSwapOpen } from '../quote-morpho-blue-swap-open';
import { ZeroXSwap_MorphoBlueRepay_ComboMeal } from '../zero-x-swap-morpho-blue-repay-combo-meal';
import { quoteMorphoBlueSwapRepay } from '../quote-morpho-blue-swap-repay';
import { ZeroXSwap_MorphoBlueClosePosition_ComboMeal } from '../zero-x-swap-morpho-blue-close-position-combo-meal';
import { quoteMorphoBlueSwapClose } from '../quote-morpho-blue-swap-close';
import { ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal } from '../zero-x-swap-morpho-blue-supply-loan-combo-meal';
import { MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal } from '../morpho-blue-withdraw-loan-zero-x-swap-combo-meal';
import { MorphoBlueClosePosition_ZeroXSwap_ComboMeal } from '../morpho-blue-close-position-zero-x-swap-combo-meal';
import { MorphoBlueBorrow_ZeroXSwap_ComboMeal } from '../morpho-blue-borrow-zero-x-swap-combo-meal';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

// ---------------------------------------------------------------------------
// Fixture
//
// Every amount below is chosen so the assertion it feeds is NOT vacuous. The
// two that matter most:
//
//   - `DEBT` sits ABOVE both swap fills, so `getRepayQuote`'s debt cap cannot
//     collapse the optimistic and conservative sizings into the same number.
//     With a smaller debt the seam test would pass against a combo that ignored
//     `minimumBuyAmount` entirely.
//   - the borrow sizing cases straddle the two fills: `BORROW_ONLY_EXPECTED_FILL`
//     is affordable at `EXPECTED_BUY_COLLATERAL` and NOT at
//     `MINIMUM_BUY_COLLATERAL`, which is the only shape that can tell a
//     guaranteed-fill sizing apart from an expected-fill one.
// ---------------------------------------------------------------------------

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'; // pragma: allowlist secret
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // pragma: allowlist secret
const ORACLE = '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2'; // pragma: allowlist secret
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC'; // pragma: allowlist secret

const LLTV = 860_000_000_000_000_000n; // 0.86e18

const market: MarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

/**
 * Blue oracle scale is `1e36 * 10^(loanDecimals - collateralDecimals)`; USDC/
 * wstETH is `1e36 * 1e-12 = 1e24`, so this is 2,000 USDC per wstETH.
 */
const ORACLE_PRICE = 2_000n * 10n ** 24n;

const LAST_UPDATE = 1_785_853_583n;
const TOTAL_SUPPLY_ASSETS = 100_000_000_000n; // 100k USDC
const TOTAL_BORROW_ASSETS = 50_000_000_000n; // 50k USDC
const TOTAL_SUPPLY_SHARES = TOTAL_SUPPLY_ASSETS * 1_000_000n;
const TOTAL_BORROW_SHARES = TOTAL_BORROW_ASSETS * 1_000_000n;

const EXECUTOR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const BORROWER = '0xbCd16D361adf5E7e0dc0010756B49666b4f38eE0';
const LENDER = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const BORROWER_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  // ~1,000 USDC of debt against 3 wstETH.
  borrowShares: 1_000_000_000n * 1_000_000n,
  collateral: 3n * 10n ** 18n,
};
const LENDER_POSITION: MorphoBluePosition = {
  supplyShares: 1_000_000_000n * 1_000_000n, // ~1,000 USDC lent
  borrowShares: 0n,
  collateral: 0n,
};
const EMPTY_POSITION: MorphoBluePosition = {
  supplyShares: 0n,
  borrowShares: 0n,
  collateral: 0n,
};

/** What `MorphoBlueAPI` will report as the borrower's debt. */
const BORROWER_DEBT = borrowAssetsForShares(
  BORROWER_POSITION.borrowShares,
  TOTAL_BORROW_ASSETS,
  TOTAL_BORROW_SHARES,
);

const blueIface = new Interface(abi.morpho.blue as InterfaceAbi);
const erc20Iface = new Interface(abi.token.erc20 as InterfaceAbi);
const oracleIface = new Interface(['function price() view returns (uint256)']);
const irmIface = new Interface([
  'function borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128)) view returns (uint256)',
]);

const positionFor = (account: string): MorphoBluePosition => {
  switch (account.toLowerCase()) {
    case BORROWER.toLowerCase():
      return BORROWER_POSITION;
    case LENDER.toLowerCase():
      return LENDER_POSITION;
    default:
      return EMPTY_POSITION;
  }
};

const makeStubProvider = (opts?: {
  authorized?: boolean;
  positionReadFails?: boolean;
  /** `0n` is a live read that returns nothing usable — `getMarket` refuses it. */
  oraclePrice?: bigint;
}): Provider => {
  const authorized = opts?.authorized ?? true;
  const oraclePrice = opts?.oraclePrice ?? ORACLE_PRICE;
  const call = async (tx: TransactionRequest): Promise<string> => {
    const to = (tx.to as string).toLowerCase();
    const data = tx.data as string;
    const selector = data.slice(0, 10);

    if (to === MORPHO_BLUE_ADDRESS.toLowerCase()) {
      if (selector === blueIface.getFunction('position')?.selector) {
        if (opts?.positionReadFails === true) {
          throw new Error('stub: RPC timed out reading position');
        }
        const account = blueIface.decodeFunctionData(
          'position',
          data,
        )[1] as string;
        const position = positionFor(account);
        return blueIface.encodeFunctionResult('position', [
          position.supplyShares,
          position.borrowShares,
          position.collateral,
        ]);
      }
      if (selector === blueIface.getFunction('market')?.selector) {
        return blueIface.encodeFunctionResult('market', [
          TOTAL_SUPPLY_ASSETS,
          TOTAL_SUPPLY_SHARES,
          TOTAL_BORROW_ASSETS,
          TOTAL_BORROW_SHARES,
          LAST_UPDATE,
          0n,
        ]);
      }
      if (selector === blueIface.getFunction('isAuthorized')?.selector) {
        return blueIface.encodeFunctionResult('isAuthorized', [authorized]);
      }
    }

    if (to === ORACLE.toLowerCase()) {
      return oracleIface.encodeFunctionResult('price', [oraclePrice]);
    }
    // Zero rate keeps `accrueMorphoBlueInterest` a no-op, so every figure in
    // this file is the arithmetic under test rather than an accrual artefact.
    if (to === IRM.toLowerCase()) {
      return irmIface.encodeFunctionResult('borrowRateView', [0n]);
    }

    if (to === USDC.toLowerCase()) {
      return erc20Iface.encodeFunctionResult('decimals', [6n]);
    }
    if (to === WSTETH.toLowerCase() || to === DAI.toLowerCase()) {
      return erc20Iface.encodeFunctionResult('decimals', [18n]);
    }

    throw new Error(`stub: unexpected call to ${to} (${selector})`);
  };
  // `getMarket` accrues to the chain head; pinning the head at `lastUpdate`
  // makes `elapsed` zero.
  const getBlock = async (): Promise<Block> =>
    ({ timestamp: Number(LAST_UPDATE) } as unknown as Block);
  return { call, getBlock } as unknown as Provider;
};

// --- 0x stub --------------------------------------------------------------

const stubQuoteBuying = (
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
        buyERC20Amount: {
          tokenAddress: params.buyERC20Info.tokenAddress,
          decimals: params.buyERC20Info.decimals,
          amount,
        },
        minimumBuyAmount,
        sellTokenAddress: params.sellERC20Amount.tokenAddress,
        price: 0n,
        guaranteedPrice: 0n,
        slippageBasisPoints: 100n,
        zid: '111111111111111111',
      } as unknown as SwapQuoteDataV2),
  );

/** The params the combo actually handed 0x — typed, so the buy/sell side it
 * derived from the market can be asserted rather than inferred. */
const quoteParamsOf = (stub: SinonStub): SwapQuoteParamsV2 =>
  stub.firstCall.args[0] as SwapQuoteParamsV2;

const daiInfo: RecipeERC20Info = {
  tokenAddress: DAI,
  decimals: 18n,
  isBaseToken: false,
};

const inputHolding = (
  tokenAddress: string,
  decimals: bigint,
  amount: bigint,
): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [{ tokenAddress, decimals, isBaseToken: false, amount }],
  nfts: [],
});

const emptyInput: RecipeInput = {
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [],
  nfts: [],
};

const decodeBlueCall = (
  calls: readonly { to?: string; data?: string }[],
  name: string,
) => {
  const fragment = blueIface.getFunction(name);
  const call = calls.find(
    candidate =>
      candidate.to?.toLowerCase() === MORPHO_BLUE_ADDRESS.toLowerCase() &&
      candidate.data?.startsWith(fragment?.selector ?? 'x') === true,
  );
  expect(call, `no ${name} call in batch`).to.not.equal(undefined);
  return blueIface.decodeFunctionData(name, call?.data ?? '0x');
};

/** The amount of the last ERC20 `approve()` in the batch targeting `token`. */
const decodeApproval = (
  calls: readonly { to?: string; data?: string }[],
  token: string,
): bigint => {
  const selector = erc20Iface.getFunction('approve')?.selector;
  const call = [...calls]
    .reverse()
    .find(
      candidate =>
        candidate.to?.toLowerCase() === token.toLowerCase() &&
        candidate.data?.startsWith(selector ?? 'x') === true,
    );
  expect(call, `no approve() call targeting ${token}`).to.not.equal(undefined);
  return erc20Iface.decodeFunctionData(
    'approve',
    call?.data ?? '0x',
  )[1] as bigint;
};

// --- swap fills -----------------------------------------------------------

const EXPECTED_BUY_COLLATERAL = 10n ** 18n; // 1 wstETH
const MINIMUM_BUY_COLLATERAL = 900_000_000_000_000_000n; // 0.9 wstETH

const EXPECTED_BUY_LOAN = 500_000_000n; // 500 USDC
const MINIMUM_BUY_LOAN = 450_000_000n; // 450 USDC

/** LLTV capacity on a fresh position holding exactly `collateral`. */
const capacityAt = (collateral: bigint): bigint =>
  computeMorphoBlueRisk({
    collateral,
    borrowAssets: 0n,
    oraclePrice: ORACLE_PRICE,
    lltv: LLTV,
  }).borrowCapacityRemaining;

const CAPACITY_AT_MINIMUM = capacityAt(MINIMUM_BUY_COLLATERAL);
const CAPACITY_AT_EXPECTED = capacityAt(EXPECTED_BUY_COLLATERAL);

describe('Morpho Blue combo meals', () => {
  let stub0xQuote: Optional<SinonStub>;

  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  afterEach(() => {
    stub0xQuote?.restore();
    stub0xQuote = undefined;
  });

  it('Should confirm the fixture straddles the two fills', () => {
    // Guards every sizing assertion below. If these ever coincide, an
    // expected-fill build and a guaranteed-fill build produce identical
    // calldata and the tests stop testing anything.
    expect(MINIMUM_BUY_LOAN < EXPECTED_BUY_LOAN).to.equal(true);
    expect(EXPECTED_BUY_LOAN < BORROWER_DEBT).to.equal(
      true,
      'the debt cap would collapse both sizings into the same repay',
    );
    expect(CAPACITY_AT_MINIMUM < CAPACITY_AT_EXPECTED).to.equal(true);
  });

  // =========================================================================
  // Entry: swap -> supply collateral + borrow
  // =========================================================================

  describe('ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal', () => {
    const build = (borrowAssets: bigint) =>
      new ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal({
        market,
        sellERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        borrowAssets,
        executor: EXECUTOR,
        provider: makeStubProvider(),
      });

    it('Should supply the swap GUARANTEED fill, not the expected one', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      const output = await build(1_000_000_000n).getComboMealOutput(
        inputHolding(DAI, 18n, 3_000n * 10n ** 18n),
      );

      const supply = decodeBlueCall(
        output.crossContractCalls,
        'supplyCollateral',
      );
      expect(supply[1]).to.equal(MINIMUM_BUY_COLLATERAL);
      // The approve must match, or Blue pulls more than was authorised.
      expect(decodeApproval(output.crossContractCalls, WSTETH)).to.equal(
        MINIMUM_BUY_COLLATERAL,
      );
      // Named explicitly so a regression that swaps in the optimistic figure
      // fails loudly rather than by an equality that happens to hold.
      expect(supply[1]).to.not.equal(EXPECTED_BUY_COLLATERAL);
    });

    it('Should buy the market collateral token, derived from the market', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      await build(1_000_000_000n).getComboMealOutput(
        inputHolding(DAI, 18n, 3_000n * 10n ** 18n),
      );

      const quoteParams = quoteParamsOf(stub0xQuote);
      expect(quoteParams.buyERC20Info.tokenAddress).to.equal(WSTETH);
      // Read on chain, not guessed: a Blue market descriptor carries no decimals.
      expect(quoteParams.buyERC20Info.decimals).to.equal(18n);
      expect(quoteParams.recipient).to.equal(EXECUTOR);
    });

    it('Should declare at least the Blue leg gas floor', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      const output = await build(1_000_000_000n).getComboMealOutput(
        inputHolding(DAI, 18n, 3_000n * 10n ** 18n),
      );
      // A combo cannot need less gas than its dearest leg; the floor is a
      // `gasleft()` require, so under-declaring reverts at the shield epilogue.
      expect(
        output.minGasLimit >= MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW,
      ).to.equal(true, `combo declared ${output.minGasLimit}`);
    });

    it('Should refuse a sell token that is already the collateral', () => {
      expect(
        () =>
          new ZeroXSwap_MorphoBlueSupplyCollateralAndBorrow_ComboMeal({
            market,
            sellERC20Info: {
              tokenAddress: WSTETH,
              decimals: 18n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            borrowAssets: 1_000_000_000n,
            executor: EXECUTOR,
            provider: makeStubProvider(),
          }),
      ).to.throw(/already the market collateral token/);
    });
  });

  // =========================================================================
  // quoteMorphoBlueSwapOpen
  // =========================================================================

  describe('quoteMorphoBlueSwapOpen', () => {
    const params = (borrowAssets?: bigint, targetLtvBasisPoints?: bigint) => ({
      networkName,
      market,
      sellERC20Amount: {
        tokenAddress: DAI,
        decimals: 18n,
        amount: 3_000n * 10n ** 18n,
      },
      swapSlippageBasisPoints: 100,
      executor: EXECUTOR,
      provider: makeStubProvider(),
      borrowAssets,
      targetLtvBasisPoints,
    });

    it('Should reject a borrow only the EXPECTED fill supports', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      // Strictly between the two capacities — the only band where an
      // expected-fill sizing and a guaranteed-fill sizing disagree.
      const borrow = CAPACITY_AT_MINIMUM + 1n;
      expect(borrow < CAPACITY_AT_EXPECTED).to.equal(
        true,
        'fixture no longer straddles the two fills',
      );

      await expect(quoteMorphoBlueSwapOpen(params(borrow))).to.be.rejectedWith(
        /exceeds the collateral bound/,
      );
    });

    it('Should accept a borrow the GUARANTEED fill supports', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      const borrow = CAPACITY_AT_MINIMUM - MORPHO_BLUE_BORROW_ROUNDING_UNIT;
      const result = await quoteMorphoBlueSwapOpen(params(borrow));

      expect(result.borrowAssets).to.equal(borrow);
      expect(result.guaranteedCollateral).to.equal(MINIMUM_BUY_COLLATERAL);
      expect(result.expectedCollateral).to.equal(EXPECTED_BUY_COLLATERAL);
      expect(result.maxBorrowAssets).to.equal(borrow);
      expect(result.borrowBound).to.equal('collateral');
      // Sized to the last accepted unit, so health sits a hair above the LLTV.
      expect(result.healthFactor).to.not.equal(undefined);
      expect((result.healthFactor as bigint) >= 10n ** 18n).to.equal(true);
      expect(result.comboOpts.borrowAssets).to.equal(borrow);
    });

    it('Should refuse exactly the un-de-rated capacity', async () => {
      // The measured one: `borrow(borrowCapacityRemaining)` reverts
      // `insufficient collateral` on a position with no prior debt (mainnet,
      // mainnet head, 2026-08-05). One unit less is accepted, on chain and here.
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      await expect(
        quoteMorphoBlueSwapOpen(params(CAPACITY_AT_MINIMUM)),
      ).to.be.rejectedWith(/exceeds the collateral bound/);
    });

    it('Should size to a target LTV when no borrow is given', async () => {
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      const result = await quoteMorphoBlueSwapOpen(
        params(undefined, 5000n), // 50 % LTV
      );
      const collateralValue =
        (MINIMUM_BUY_COLLATERAL * ORACLE_PRICE) / 10n ** 36n;
      expect(result.borrowAssets).to.equal(collateralValue / 2n);
      expect(result.borrowAssets < CAPACITY_AT_MINIMUM).to.equal(true);
    });

    it('Should refuse to guess when neither borrow nor target LTV is given', async () => {
      await expect(quoteMorphoBlueSwapOpen(params())).to.be.rejectedWith(
        /pass borrowAssets, or targetLtvBasisPoints/,
      );
    });

    it('Should NOT treat an unreadable position as an empty one', async () => {
      // §9. An empty position is exactly the state that makes any borrow look
      // fully collateralised by this batch alone, so mapping a read failure to
      // one is the specific error this guard exists to prevent.
      stub0xQuote = stubQuoteBuying(
        EXPECTED_BUY_COLLATERAL,
        MINIMUM_BUY_COLLATERAL,
      );
      await expect(
        quoteMorphoBlueSwapOpen({
          ...params(1_000_000n),
          provider: makeStubProvider({ positionReadFails: true }),
        }),
      ).to.be.rejectedWith(/could not read .* position/);
    });
  });

  // =========================================================================
  // morphoBlueBorrowCeiling — pure math
  // =========================================================================

  describe('morphoBlueBorrowCeiling', () => {
    it('Should pin the rounding unit at the measured one unit', () => {
      // Asserted as a literal, not against the constant it de-rates by, so that
      // dropping the de-rate fails here too rather than only in the quote test.
      // Measured on mainnet: borrow(maxBorrowAssets) reverts `insufficient
      // collateral` on a fresh position, borrow(maxBorrowAssets - 1) is accepted.
      expect(MORPHO_BLUE_BORROW_ROUNDING_UNIT).to.equal(1n);
    });

    it('Should de-rate the collateral bound by the measured rounding unit', () => {
      const ceiling = morphoBlueBorrowCeiling({
        collateral: EXPECTED_BUY_COLLATERAL,
        existingBorrowAssets: 0n,
        oraclePrice: ORACLE_PRICE,
        lltv: LLTV,
        liquidityAssets: 10n ** 15n,
      });
      expect(ceiling.collateralLimited).to.equal(
        CAPACITY_AT_EXPECTED - MORPHO_BLUE_BORROW_ROUNDING_UNIT,
      );
      expect(ceiling.bound).to.equal('collateral');
    });

    it('Should take the liquidity bound when it is tighter, un-de-rated', () => {
      // `borrow` requires `totalBorrowAssets <= totalSupplyAssets`, so drawing
      // exactly the free liquidity leaves them equal and passes. Measured:
      // borrow(2782135708226) accepted, borrow(+1) reverted.
      const liquidityAssets = 1_000n;
      const ceiling = morphoBlueBorrowCeiling({
        collateral: EXPECTED_BUY_COLLATERAL,
        existingBorrowAssets: 0n,
        oraclePrice: ORACLE_PRICE,
        lltv: LLTV,
        liquidityAssets,
      });
      expect(ceiling.ceiling).to.equal(liquidityAssets);
      expect(ceiling.bound).to.equal('liquidity');
    });

    it('Should floor at zero rather than go negative on an underwater position', () => {
      const ceiling = morphoBlueBorrowCeiling({
        collateral: EXPECTED_BUY_COLLATERAL,
        existingBorrowAssets: CAPACITY_AT_EXPECTED * 10n,
        oraclePrice: ORACLE_PRICE,
        lltv: LLTV,
        liquidityAssets: 10n ** 15n,
      });
      expect(ceiling.ceiling).to.equal(0n);
    });
  });

  // =========================================================================
  // Entry: swap -> repay
  // =========================================================================

  describe('ZeroXSwap_MorphoBlueRepay_ComboMeal', () => {
    const build = () =>
      new ZeroXSwap_MorphoBlueRepay_ComboMeal({
        market,
        sellERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider(),
      });

    it('Should encode repay(GUARANTEED fill), not repay(expected fill)', async () => {
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      const output = await build().getComboMealOutput(
        inputHolding(DAI, 18n, 600n * 10n ** 18n),
      );

      const repay = decodeBlueCall(output.crossContractCalls, 'repay');
      expect(repay[1]).to.equal(MINIMUM_BUY_LOAN); // assets
      expect(repay[2]).to.equal(0n); // shares — assets-mode
      expect(getAddress(repay[3] as string)).to.equal(BORROWER);
      // Both fills are under the debt, so the cap cannot be what produced this.
      expect(repay[1]).to.not.equal(EXPECTED_BUY_LOAN);
      expect(decodeApproval(output.crossContractCalls, USDC)).to.equal(
        MINIMUM_BUY_LOAN,
      );
    });

    it('Should refuse a sell token that is already the loan token', () => {
      expect(
        () =>
          new ZeroXSwap_MorphoBlueRepay_ComboMeal({
            market,
            sellERC20Info: {
              tokenAddress: USDC,
              decimals: 6n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            executor: EXECUTOR,
            provider: makeStubProvider(),
          }),
      ).to.throw(/already the market loan token/);
    });
  });

  describe('quoteMorphoBlueSwapRepay', () => {
    const params = (requireFullRepay = false) => ({
      networkName,
      market,
      sellERC20Amount: {
        tokenAddress: DAI,
        decimals: 18n,
        amount: 600n * 10n ** 18n,
      },
      swapSlippageBasisPoints: 100,
      executor: EXECUTOR,
      owner: BORROWER,
      provider: makeStubProvider(),
      requireFullRepay,
    });

    it('Should report a short repay rather than pretending it clears the debt', async () => {
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      const result = await quoteMorphoBlueSwapRepay(params());

      expect(result.debt).to.equal(BORROWER_DEBT);
      expect(result.repayAssets).to.equal(MINIMUM_BUY_LOAN);
      expect(result.remainingDebt).to.equal(BORROWER_DEBT - MINIMUM_BUY_LOAN);
      expect(result.clearsDebt).to.equal(false);
      // The expected fill is also short here, so `clearsDebt: false` is not an
      // artefact of conservatism.
      expect(result.expectedLoanToken < result.debt).to.equal(true);
    });

    it('Should refuse to build a short repay when the caller demands a full one', async () => {
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      await expect(
        quoteMorphoBlueSwapRepay(params(true)),
      ).to.be.rejectedWith(/covers only/);
    });

    it('Should cap the reported repay at the debt when the fill exceeds it', async () => {
      const over = BORROWER_DEBT * 2n;
      stub0xQuote = stubQuoteBuying(over + 1n, over);
      const result = await quoteMorphoBlueSwapRepay(params(true));

      expect(result.repayAssets).to.equal(BORROWER_DEBT);
      expect(result.remainingDebt).to.equal(0n);
      expect(result.clearsDebt).to.equal(true);
    });

    it('Should refuse a market where the owner carries no debt', async () => {
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      await expect(
        quoteMorphoBlueSwapRepay({ ...params(), owner: LENDER }),
      ).to.be.rejectedWith(/no borrow shares to repay/);
    });

    it('Should quote a repay on a market whose oracle is dead', async () => {
      // A repay needs no price, and an unpriceable market is the one a borrower
      // most wants out of. `getPositionRisks` would refuse here, which is why
      // this builder does not use it.
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      const deadOracle = makeStubProvider({ oraclePrice: 0n });

      // Non-vacuous: the same provider must actually break an oracle-dependent
      // read, or this test would pass against a stub that silently ignored the
      // override.
      await expect(
        quoteMorphoBlueSwapOpen({
          networkName,
          market,
          sellERC20Amount: {
            tokenAddress: DAI,
            decimals: 18n,
            amount: 3_000n * 10n ** 18n,
          },
          swapSlippageBasisPoints: 100,
          executor: EXECUTOR,
          provider: deadOracle,
          borrowAssets: 1_000_000n,
        }),
      ).to.be.rejectedWith(/returned price 0/);

      const result = await quoteMorphoBlueSwapRepay({
        ...params(),
        provider: deadOracle,
      });
      expect(result.debt).to.equal(BORROWER_DEBT);
      expect(result.repayAssets).to.equal(MINIMUM_BUY_LOAN);
    });
  });

  // =========================================================================
  // Entry: swap -> close position
  // =========================================================================

  describe('ZeroXSwap_MorphoBlueClosePosition_ComboMeal / quoteMorphoBlueSwapClose', () => {
    const REPAY_SLIPPAGE_BPS = 100n;
    const MAX_REPAID = BORROWER_DEBT + (BORROWER_DEBT * REPAY_SLIPPAGE_BPS) / 10000n;

    const quoteParams = (amount: bigint) => ({
      networkName,
      market,
      sellERC20Amount: { tokenAddress: DAI, decimals: 18n, amount },
      swapSlippageBasisPoints: 100,
      repaySlippageBasisPoints: REPAY_SLIPPAGE_BPS,
      executor: EXECUTOR,
      owner: BORROWER,
      provider: makeStubProvider(),
    });

    it('Should refuse a fill that covers the debt but not the repay budget', async () => {
      // The non-vacuous shape: guaranteed < maxRepaid < expected. A build sized
      // on the expected fill passes every naive check and still under-funds the
      // shares repay.
      const guaranteed = MAX_REPAID - 1n;
      const expected = MAX_REPAID + 10_000_000n;
      expect(guaranteed > BORROWER_DEBT).to.equal(
        true,
        'the guaranteed fill must cover the DEBT but not the BUDGET, or this ' +
          'test proves only that a too-small swap is refused',
      );
      stub0xQuote = stubQuoteBuying(expected, guaranteed);

      await expect(
        quoteMorphoBlueSwapClose(quoteParams(1_100n * 10n ** 18n)),
      ).to.be.rejectedWith(/below the close's repay budget/);
    });

    it('Should accept a fill that covers the repay budget and report the surplus', async () => {
      const guaranteed = MAX_REPAID + 5_000_000n;
      stub0xQuote = stubQuoteBuying(guaranteed + 10_000_000n, guaranteed);

      const result = await quoteMorphoBlueSwapClose(
        quoteParams(1_100n * 10n ** 18n),
      );
      expect(result.repayShares).to.equal(BORROWER_POSITION.borrowShares);
      expect(result.maxRepaidAssets).to.equal(MAX_REPAID);
      expect(result.withdrawCollateral).to.equal(BORROWER_POSITION.collateral);
      expect(result.surplusLoanToken).to.equal(guaranteed - MAX_REPAID);
    });

    it('Should encode a shares repay and a full collateral withdrawal', async () => {
      const guaranteed = MAX_REPAID + 5_000_000n;
      stub0xQuote = stubQuoteBuying(guaranteed + 10_000_000n, guaranteed);

      const combo = new ZeroXSwap_MorphoBlueClosePosition_ComboMeal({
        market,
        sellERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        repaySlippageBasisPoints: REPAY_SLIPPAGE_BPS,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider(),
      });
      const output = await combo.getComboMealOutput(
        inputHolding(DAI, 18n, 1_100n * 10n ** 18n),
      );

      const repay = decodeBlueCall(output.crossContractCalls, 'repay');
      expect(repay[1]).to.equal(0n); // assets — shares mode
      expect(repay[2]).to.equal(BORROWER_POSITION.borrowShares);
      const withdraw = decodeBlueCall(
        output.crossContractCalls,
        'withdrawCollateral',
      );
      expect(withdraw[1]).to.equal(BORROWER_POSITION.collateral);
      expect(getAddress(withdraw[3] as string)).to.equal(EXECUTOR);
    });

    it("Should let the close recipe's own budget guard fire on an underfunded seam", async () => {
      // The backstop, exercised through the conservative seam: the recipe sees
      // the GUARANTEED fill, not the expected one, so it refuses to build.
      const guaranteed = MAX_REPAID - 1n;
      stub0xQuote = stubQuoteBuying(MAX_REPAID + 10_000_000n, guaranteed);

      const combo = new ZeroXSwap_MorphoBlueClosePosition_ComboMeal({
        market,
        sellERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        repaySlippageBasisPoints: REPAY_SLIPPAGE_BPS,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider(),
      });
      await expect(
        combo.getComboMealOutput(inputHolding(DAI, 18n, 1_100n * 10n ** 18n)),
      ).to.be.rejectedWith(/< required/);
    });
  });

  // =========================================================================
  // Lend side
  // =========================================================================

  describe('ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal', () => {
    it('Should supply the GUARANTEED fill on behalf of the owner', async () => {
      stub0xQuote = stubQuoteBuying(EXPECTED_BUY_LOAN, MINIMUM_BUY_LOAN);
      const combo = new ZeroXSwap_MorphoBlueSupplyLoan_ComboMeal({
        market,
        sellERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        executor: EXECUTOR,
        owner: LENDER,
        provider: makeStubProvider(),
      });
      const output = await combo.getComboMealOutput(
        inputHolding(DAI, 18n, 600n * 10n ** 18n),
      );

      const supply = decodeBlueCall(output.crossContractCalls, 'supply');
      expect(supply[1]).to.equal(MINIMUM_BUY_LOAN); // assets
      expect(supply[2]).to.equal(0n); // shares
      expect(getAddress(supply[3] as string)).to.equal(LENDER);
      expect(supply[1]).to.not.equal(EXPECTED_BUY_LOAN);
      expect(decodeApproval(output.crossContractCalls, USDC)).to.equal(
        MINIMUM_BUY_LOAN,
      );
    });
  });

  describe('MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal', () => {
    const build = (withdrawAssets?: bigint) =>
      new MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal({
        market,
        buyERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        executor: EXECUTOR,
        owner: LENDER,
        provider: makeStubProvider(),
        withdrawAssets,
      });

    it('Should exit the whole claim in SHARES when no amount is given', async () => {
      stub0xQuote = stubQuoteBuying(
        900n * 10n ** 18n,
        890n * 10n ** 18n,
      );
      const output = await build().getComboMealOutput(emptyInput);

      const withdraw = decodeBlueCall(output.crossContractCalls, 'withdraw');
      expect(withdraw[1]).to.equal(0n); // assets
      expect(withdraw[2]).to.equal(LENDER_POSITION.supplyShares); // shares
      expect(getAddress(withdraw[3] as string)).to.equal(LENDER); // onBehalf
      expect(getAddress(withdraw[4] as string)).to.equal(EXECUTOR); // receiver
    });

    it('Should sell the market loan token, derived from the market', async () => {
      stub0xQuote = stubQuoteBuying(900n * 10n ** 18n, 890n * 10n ** 18n);
      await build().getComboMealOutput(emptyInput);

      const quoteParams = quoteParamsOf(stub0xQuote);
      // Lowercased: `Recipe.getRecipeOutput` keys `erc20AmountRecipients` by
      // `tokenAddress.toLowerCase()`, so that is what crosses the seam.
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        USDC.toLowerCase(),
      );
      expect(quoteParams.sellERC20Amount.decimals).to.equal(6n);
      expect(quoteParams.buyERC20Info.tokenAddress).to.equal(DAI);
    });

    it('Should refuse a partial withdrawal above the free liquidity', async () => {
      // Free liquidity is the lend-side constraint with no collateral analogue,
      // and the revert is swallowed on chain — so the refusal must be here.
      const free = TOTAL_SUPPLY_ASSETS - TOTAL_BORROW_ASSETS;
      await expect(
        build(free + 1n).getComboMealOutput(emptyInput),
      ).to.be.rejectedWith(/exceeds the market's free liquidity/);
    });

    it('Should accept a partial withdrawal at exactly the free liquidity', async () => {
      // Measured boundary: `withdraw(free)` is accepted on chain and
      // `withdraw(free + 1)` reverts, so the builder must not de-rate here.
      const free = TOTAL_SUPPLY_ASSETS - TOTAL_BORROW_ASSETS;
      stub0xQuote = stubQuoteBuying(10n ** 18n, 10n ** 18n);
      const output = await build(free).getComboMealOutput(emptyInput);

      const withdraw = decodeBlueCall(output.crossContractCalls, 'withdraw');
      expect(withdraw[1]).to.equal(free);
      expect(withdraw[2]).to.equal(0n);
    });

    it('Should refuse a buy token that is already the loan token', () => {
      expect(
        () =>
          new MorphoBlueWithdrawLoan_ZeroXSwap_ComboMeal({
            market,
            buyERC20Info: {
              tokenAddress: USDC,
              decimals: 6n,
              isBaseToken: false,
            },
            swapSlippageBasisPoints: 100,
            executor: EXECUTOR,
            provider: makeStubProvider(),
          }),
      ).to.throw(/already the market loan token/);
    });
  });

  // =========================================================================
  // Exits with the swap last
  // =========================================================================

  describe('MorphoBlueClosePosition_ZeroXSwap_ComboMeal', () => {
    it('Should sell exactly the collateral the close withdraws', async () => {
      stub0xQuote = stubQuoteBuying(6_000n * 10n ** 18n, 5_900n * 10n ** 18n);
      const combo = new MorphoBlueClosePosition_ZeroXSwap_ComboMeal({
        market,
        buyERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        repaySlippageBasisPoints: 100n,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider(),
      });
      const output = await combo.getComboMealOutput(
        inputHolding(USDC, 6n, 2_000_000_000n),
      );

      const quoteParams = quoteParamsOf(stub0xQuote);
      expect(quoteParams.sellERC20Amount.tokenAddress.toLowerCase()).to.equal(
        WSTETH.toLowerCase(),
      );
      // Over-declaring here is an order for more than the executor holds; the
      // 0x call reverts and `requireSuccess = false` mines it anyway.
      expect(quoteParams.sellERC20Amount.amount).to.equal(
        BORROWER_POSITION.collateral,
      );
      expect(output.crossContractCalls.length > 0).to.equal(true);
    });
  });

  describe('MorphoBlueBorrow_ZeroXSwap_ComboMeal', () => {
    it('Should sell exactly the borrowed loan token', async () => {
      const borrowAssets = 100_000_000n;
      stub0xQuote = stubQuoteBuying(99n * 10n ** 18n, 98n * 10n ** 18n);
      const combo = new MorphoBlueBorrow_ZeroXSwap_ComboMeal({
        market,
        borrowAssets,
        buyERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider(),
      });
      const output = await combo.getComboMealOutput(emptyInput);

      const borrow = decodeBlueCall(output.crossContractCalls, 'borrow');
      expect(borrow[1]).to.equal(borrowAssets);
      expect(getAddress(borrow[3] as string)).to.equal(BORROWER); // onBehalf
      expect(getAddress(borrow[4] as string)).to.equal(EXECUTOR); // receiver

      const quoteParams = quoteParamsOf(stub0xQuote);
      expect(quoteParams.sellERC20Amount.amount).to.equal(borrowAssets);
    });

    it('Should refuse a delegated borrow the owner never authorised', async () => {
      stub0xQuote = stubQuoteBuying(99n * 10n ** 18n, 98n * 10n ** 18n);
      const combo = new MorphoBlueBorrow_ZeroXSwap_ComboMeal({
        market,
        borrowAssets: 100_000_000n,
        buyERC20Info: daiInfo,
        swapSlippageBasisPoints: 100,
        executor: EXECUTOR,
        owner: BORROWER,
        provider: makeStubProvider({ authorized: false }),
      });
      await expect(
        combo.getComboMealOutput(emptyInput),
      ).to.be.rejectedWith(/UNAUTHORIZED/);
    });
  });
});
