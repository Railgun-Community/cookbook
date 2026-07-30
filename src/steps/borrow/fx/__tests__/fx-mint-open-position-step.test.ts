import chai from 'chai';
import { Interface } from 'ethers';
import { FxMintOpenPositionStep } from '../fx-mint-open-position-step';
import {
  FEE_DENOM,
  FX_ADDRESSES,
  FX_POOL_MANAGER_ABI,
  resolvePool,
} from '../fx-mint-util';
import { NetworkName, NFTTokenType } from '@railgun-community/shared-models';
import type { StepInput } from '../../../../models/export-models';

const { expect } = chai;

describe('FxMintOpenPositionStep', () => {
  const wstETHPool = resolvePool('wstETH-Long');
  const wbtcPool = resolvePool('WBTC-Long');

  const targetDebt = 5_000_000_000_000_000_000n; // 5 fxUSD
  const predictedPositionId = 1903n;

  function makeStepInput(
    collateralAmount: bigint,
    decimals: bigint,
    collateralToken: string,
  ): StepInput {
    return {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: collateralToken,
          decimals,
          isBaseToken: false,
          expectedBalance: collateralAmount,
          minBalance: collateralAmount,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
  }

  it('encodes operate() with the correct args (wstETH-Long)', async () => {
    const step = new FxMintOpenPositionStep({
      pool: wstETHPool,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio: 5_000_000n, // 0.5% (current mainnet value, in 1e9 denom)
    });

    const collateralAmount = 4_000_000_000_000_000n;
    const output = await step.getValidStepOutput(
      makeStepInput(collateralAmount, 18n, wstETHPool.collateralToken),
    );

    // Single cross-contract call to PoolManager.
    expect(output.crossContractCalls).to.have.length(1);
    expect(output.crossContractCalls[0].to.toLowerCase()).to.equal(
      FX_ADDRESSES.fxPoolManager.toLowerCase(),
    );

    // outputERC20Amounts: fxUSD post-borrow-fee net.
    const expectedFxUSDNet = targetDebt - (targetDebt * 5_000_000n) / FEE_DENOM;
    expect(output.outputERC20Amounts).to.have.length(1);
    expect(output.outputERC20Amounts[0].tokenAddress.toLowerCase()).to.equal(
      FX_ADDRESSES.fxUSD.toLowerCase(),
    );
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(
      expectedFxUSDNet,
    );

    // outputNFTs: position NFT at the pool address.
    expect(output.outputNFTs).to.deep.equal([
      {
        nftAddress: wstETHPool.address,
        tokenSubID: '0x' + predictedPositionId.toString(16),
        nftTokenType: NFTTokenType.ERC721,
        amount: 1n,
      },
    ]);

    // spentERC20Amounts: collateral with the right decimals (18 here).
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        tokenAddress: wstETHPool.collateralToken,
        decimals: 18n,
        amount: collateralAmount,
        recipient: FX_ADDRESSES.fxPoolManager,
      },
    ]);
  });

  it('encodes correctly with WBTC-Long collateralDecimals=8 and a different borrow fee', async () => {
    const step = new FxMintOpenPositionStep({
      pool: wbtcPool,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio: 7_500_000n, // pretend governance moved it to 0.75%
    });

    const collateralAmount = 100_000n; // 0.001 WBTC at 8 decimals
    const output = await step.getValidStepOutput(
      makeStepInput(collateralAmount, 8n, wbtcPool.collateralToken),
    );

    // Net = targetDebt × (1e9 - 7.5e6) / 1e9 = 5e18 × 0.9925 = 4.9625e18
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(
      4_962_500_000_000_000_000n,
    );

    // Collateral-side decimals plumbed through correctly.
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        tokenAddress: wbtcPool.collateralToken,
        decimals: 8n,
        amount: collateralAmount,
        recipient: FX_ADDRESSES.fxPoolManager,
      },
    ]);
  });

  it('encodes the guaranteed minimum, not the optimistic expectation', async () => {
    // A non-deterministic upstream (0x swap) delivers somewhere in
    // [minBalance, expectedBalance]. operate() pulls an EXACT amount, so
    // encoding expectedBalance would revert the batch on any underfill.
    const step = new FxMintOpenPositionStep({
      pool: wstETHPool,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio: 5_000_000n,
    });

    const input = makeStepInput(1000n, 18n, wstETHPool.collateralToken);
    input.erc20Amounts[0].minBalance = 900n;

    const output = await step.getValidStepOutput(input);

    // The wire carries 900n, not 1000n.
    const decoded = new Interface(FX_POOL_MANAGER_ABI).decodeFunctionData(
      'operate',
      output.crossContractCalls[0].data,
    );
    expect(decoded[2]).to.equal(900n);

    // Spend matches what operate() actually pulls.
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        tokenAddress: wstETHPool.collateralToken,
        decimals: 18n,
        amount: 900n,
        recipient: FX_ADDRESSES.fxPoolManager,
      },
    ]);

    // The 100n surplus is declared so accounting closes, and reshields.
    const surplus = output.outputERC20Amounts.find(
      o =>
        o.tokenAddress.toLowerCase() ===
        wstETHPool.collateralToken.toLowerCase(),
    );
    if (!surplus) {
      throw new Error('expected a collateral surplus output');
    }
    expect(surplus.expectedBalance).to.equal(100n);
    expect(surplus.minBalance).to.equal(0n);
  });

  describe('short pools (f(x) v2.1)', () => {
    const stETHShort = resolvePool('stETH-Short');
    const wbtcShort = resolvePool('WBTC-Short');

    it('routes to the ShortPoolManager, not the long manager', async () => {
      const step = new FxMintOpenPositionStep({
        pool: stETHShort,
        // Borrowing 1 wstETH against fxUSD collateral.
        targetDebt: 1_000_000_000_000_000_000n,
        predictedPositionId: 171n,
        borrowFeeRatio: 0n, // shorts charge nothing on borrow today
      });

      const fxUSDCollateral = 5_000_000_000_000_000_000_000n; // 5000 fxUSD
      const output = await step.getValidStepOutput(
        makeStepInput(fxUSDCollateral, 18n, stETHShort.collateralToken),
      );

      // The whole reason the manager is carried per-pool: sending this to the
      // long manager would revert as an unregistered pool.
      expect(output.crossContractCalls[0].to.toLowerCase()).to.equal(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );
      expect(output.crossContractCalls[0].to.toLowerCase()).to.not.equal(
        FX_ADDRESSES.fxPoolManager.toLowerCase(),
      );

      // Spends fxUSD (collateral), outputs wstETH (debt) — the mirror of a long.
      expect(output.spentERC20Amounts).to.deep.equal([
        {
          tokenAddress: FX_ADDRESSES.fxUSD,
          decimals: 18n,
          amount: fxUSDCollateral,
          recipient: FX_ADDRESSES.fxShortPoolManager,
        },
      ]);
      expect(output.outputERC20Amounts).to.have.length(1);
      expect(output.outputERC20Amounts[0].tokenAddress.toLowerCase()).to.equal(
        FX_ADDRESSES.wstETH.toLowerCase(),
      );
      // borrowFeeRatio 0 → the full borrowed amount is received.
      expect(output.outputERC20Amounts[0].expectedBalance).to.equal(
        1_000_000_000_000_000_000n,
      );
    });

    it('declares 8-decimal WBTC debt against 18-decimal fxUSD collateral', async () => {
      const step = new FxMintOpenPositionStep({
        pool: wbtcShort,
        targetDebt: 5_000_000n, // 0.05 WBTC, 8dp
        predictedPositionId: 102n,
        borrowFeeRatio: 0n,
      });

      const output = await step.getValidStepOutput(
        makeStepInput(2_000_000_000_000_000_000_000n, 18n, wbtcShort.collateralToken),
      );

      // Decimals sit on opposite sides from WBTC-Long. Getting this wrong is a
      // silent 10^10 error rather than a revert.
      const collSpent = (output.spentERC20Amounts ?? [])[0];
      if (!collSpent) {
        throw new Error('expected a collateral spend line');
      }
      expect(collSpent.decimals).to.equal(18n);
      const debtOut = output.outputERC20Amounts.find(
        o => o.tokenAddress.toLowerCase() === wbtcShort.debtToken.toLowerCase(),
      );
      if (!debtOut) {
        throw new Error('expected a WBTC debt output');
      }
      expect(debtOut.decimals).to.equal(8n);
      expect(debtOut.expectedBalance).to.equal(5_000_000n);
    });

    it('encodes operate() against the short pool address with positionId 0', async () => {
      const step = new FxMintOpenPositionStep({
        pool: stETHShort,
        targetDebt: 1_000_000_000_000_000_000n,
        predictedPositionId: 171n,
        borrowFeeRatio: 0n,
      });
      const output = await step.getValidStepOutput(
        makeStepInput(5_000_000_000_000_000_000_000n, 18n, stETHShort.collateralToken),
      );

      const iface = new Interface(FX_POOL_MANAGER_ABI);
      const decoded = iface.parseTransaction({
        data: output.crossContractCalls[0].data as string,
      });
      if (!decoded) {
        throw new Error('could not decode operate() calldata');
      }
      expect(decoded.name).to.equal('operate');
      expect((decoded.args[0] as string).toLowerCase()).to.equal(
        stETHShort.address.toLowerCase(),
      );
      expect(decoded.args[1]).to.equal(0n); // mint-new
      // The NFT is declared at the short pool's own address.
      expect(output.outputNFTs[0].nftAddress.toLowerCase()).to.equal(
        stETHShort.address.toLowerCase(),
      );
    });
  });
});
