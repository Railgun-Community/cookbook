import chai from 'chai';
import Sinon, { SinonStub } from 'sinon';
import { NetworkName } from '@railgun-community/shared-models';
import { JsonRpcProvider } from 'ethers';
import { UniV2LikeSDK } from '../uni-v2-like-sdk';
import { UniV2LikePairContract } from '../../../contract/liquidity/uni-v2-like-pair-contract';
import { UniV2LikeFactoryContract } from '../../../contract/liquidity/uni-v2-like-factory-contract';
import { RecipeERC20Info, UniswapV2Fork } from '../../../models/export-models';

const { expect } = chai;

const networkName = NetworkName.Ethereum;

const one6 = 10n ** 6n;
const one18 = 10n ** 18n;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // pragma: allowlist secret
  decimals: 6n,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // pragma: allowlist secret
  decimals: 18n,
};
const LP_ADDRESS = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc'; // pragma: allowlist secret
const FEE_TO = '0xf38521f130fcCF29dB1961597bc5d2B60F995f85'; // pragma: allowlist secret
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'; // pragma: allowlist secret

const RESERVE_A = one6 * 2_000_000_000n; // USDC
const RESERVE_B = one18 * 1_000_000n; // WETH
const TOTAL_SUPPLY = one18 * 2_000_000n;

/**
 * Uniswap's protocol fee, and what it does to a withdrawal.
 *
 * `getLPFeeAmount` returns the liquidity `_mintFee` would mint to `feeTo` on the
 * next `mint`/`burn` — a POOL-WIDE quantity. The remove path used to subtract it
 * from the caller's own LP balance, which understated every withdrawal and went
 * negative outright once the pool's accrued fee exceeded the caller's position.
 * A negative expected amount then fails to encode at all: `amountAMin` is a
 * uint256.
 *
 * That was unreachable while Uniswap's fee switch was off — `feeTo == 0`
 * short-circuits the fee to zero — and the recipe tests that would have caught
 * it pointed at a dead RPC. Both of those stopped being true, in that order.
 *
 * `kLast` is stubbed here alongside the reserves deliberately: they feed the
 * same computation, so a live `kLast` against invented reserves produces a fee
 * bearing no relation to either.
 */
describe('uni-v2-like protocol fee — remove liquidity', () => {
  const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com');

  let getReserves: SinonStub;
  let totalSupply: SinonStub;
  let kLast: SinonStub;
  let feeTo: SinonStub;

  const stubPool = (kLastValue: bigint, feeToValue: string): void => {
    getReserves = Sinon.stub(
      UniV2LikePairContract.prototype,
      'getReserves',
    ).resolves({ reserveA: RESERVE_A, reserveB: RESERVE_B });
    totalSupply = Sinon.stub(
      UniV2LikePairContract.prototype,
      'totalSupply',
    ).resolves(TOTAL_SUPPLY);
    kLast = Sinon.stub(UniV2LikePairContract.prototype, 'kLast').resolves(
      kLastValue,
    );
    feeTo = Sinon.stub(UniV2LikeFactoryContract.prototype, 'feeTo').resolves(
      feeToValue,
    );
  };

  afterEach(() => {
    getReserves.restore();
    totalSupply.restore();
    kLast.restore();
    feeTo.restore();
  });

  const removeData = async (lpAmount: bigint) =>
    UniV2LikeSDK.getRemoveLiquidityData(
      UniswapV2Fork.Uniswap,
      networkName,
      { tokenAddress: LP_ADDRESS, decimals: 18n, amount: lpAmount },
      USDC_TOKEN,
      WETH_TOKEN,
      100n,
      provider,
    );

  it('Should quote a withdrawal smaller than the pool-wide accrued fee', async () => {
    // `kLast` a quarter of current k — a pool that has traded a long way since
    // its last mint or burn, so the fee owed is large in absolute terms. The
    // caller holds 2 LP against a 2,000,000 LP supply.
    stubPool((RESERVE_A * RESERVE_B) / 4n, FEE_TO);

    const data = await removeData(one18 * 2n);

    // Positive is the whole point: this is the case that used to underflow.
    expect(data.expectedERC20AmountA.amount > 0n).to.equal(
      true,
      'USDC leg must be positive',
    );
    expect(data.expectedERC20AmountB.amount > 0n).to.equal(
      true,
      'WETH leg must be positive',
    );
  });

  it('Should treat the fee as dilution, not as a deduction', async () => {
    // The fee raises the supply the burn divides by, so a fee-bearing pool must
    // return strictly LESS per LP than a fee-settled one — but on the order of
    // the dilution, not by a pool-wide constant subtracted from the caller.
    const lpAmount = one18 * 2n;

    stubPool(RESERVE_A * RESERVE_B, FEE_TO); // rootK == rootKLast: nothing owed
    const settled = await removeData(lpAmount);
    getReserves.restore();
    totalSupply.restore();
    kLast.restore();
    feeTo.restore();

    stubPool((RESERVE_A * RESERVE_B) / 4n, FEE_TO);
    const diluted = await removeData(lpAmount);

    expect(settled.expectedERC20AmountA.amount).to.equal(
      (lpAmount * RESERVE_A) / TOTAL_SUPPLY,
      'a settled pool pays the undiluted share',
    );
    expect(
      diluted.expectedERC20AmountA.amount < settled.expectedERC20AmountA.amount,
    ).to.equal(true, 'dilution must reduce the payout');
    // Dilution here is bounded well under half; a deduction would have driven
    // this far negative.
    expect(
      diluted.expectedERC20AmountA.amount >
        settled.expectedERC20AmountA.amount / 2n,
    ).to.equal(true, 'dilution must not behave like a deduction');
  });

  it('Should be unaffected by kLast when the fee switch is off', async () => {
    stubPool((RESERVE_A * RESERVE_B) / 4n, ZERO_ADDRESS);

    const data = await removeData(one18 * 2n);

    expect(data.expectedERC20AmountA.amount).to.equal(
      (one18 * 2n * RESERVE_A) / TOTAL_SUPPLY,
    );
    expect(data.expectedERC20AmountB.amount).to.equal(
      (one18 * 2n * RESERVE_B) / TOTAL_SUPPLY,
    );
  });
});
