import chai from 'chai';
import { FxMintClosePositionStep } from '../fx-mint-close-position-step';
import { FX_ADDRESSES, resolvePool } from '../fx-mint-util';
import { NetworkName, NFTTokenType } from '@railgun-community/shared-models';
import type { StepInput } from '../../../../models/export-models';

const { expect } = chai;

// Task 5 — verifies collateralDecimals is plumbed through every output/spent
// line that references the COLLATERAL token. fxUSD lines (which are always
// 18-decimal) must continue to carry decimals=18n.
//
// The bug we're guarding against: pre-Task-5 the close step hardcoded
// `decimals: 18n` on the collateral output, which would mis-account WBTC
// (8-decimal) by a factor of 10^10.
describe('FxMintClosePositionStep', () => {
  // The PoolManager-approved fxUSD input must carry approveAmount =
  // repayAmount + repayFee. Cookbook's accounting validator only accepts
  // the input if `expectedBalance >= minBalance` and the step then declares
  // `feeAmount = approveAmount - repayAmount` so input == spent + fee +
  // outputs balances exactly. We use a tiny made-up fee so the math is
  // self-consistent for the test — actual close-side fee comes from
  // `computeFxClose` at the recipe layer.
  const repayAmount = 5_000_000_000_000_000_000n; // 5 fxUSD
  // 0.025 fxUSD = 0.5% of repayAmount. The on-chain f(x) repay fee is a
  // 1e9-denominated ratio (see FEE_DENOM in fx-mint-util); this test just
  // needs `approveAmount > repayAmount` so the close step's accounting
  // (input == spent + fee + outputs) has a non-zero fee leg to declare.
  const repayFee = 25_000_000_000_000_000n;
  const approveAmount = repayAmount + repayFee;
  const withdrawColl = 100_000n; // 0.001 WBTC at 8 decimals
  const positionId = 1903n;
  const fxUSD = FX_ADDRESSES.fxUSD;
  const poolManager = FX_ADDRESSES.fxPoolManager;

  function makeStepInput(nftAddress: string): StepInput {
    return {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: fxUSD,
          decimals: 18n,
          isBaseToken: false,
          expectedBalance: approveAmount,
          minBalance: approveAmount,
          // Must match poolManager so the close step's lookup picks this up
          // as the approved input (vs an "orphan" pass-through).
          approvedSpender: poolManager,
        },
      ],
      nfts: [
        {
          nftAddress,
          tokenSubID: '0x' + positionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };
  }

  it('plumbs collateralDecimals through to outputERC20Amounts (WBTC-Long, partial close)', async () => {
    const wbtcPool = resolvePool('WBTC-Long');

    const step = new FxMintClosePositionStep({
      pool: wbtcPool,
      positionId,
      repayAmount,
      withdrawColl,
      withdrawFeeRatio: 0n, // long pool
      partialClose: true,
    });

    const output = await step.getValidStepOutput(
      makeStepInput(wbtcPool.address),
    );

    // Every output/spent line referencing the WBTC collateral must carry decimals = 8.
    const collateralLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter(
      l =>
        l.tokenAddress.toLowerCase() === wbtcPool.collateralToken.toLowerCase(),
    );

    expect(collateralLines).to.have.length.greaterThan(0);
    for (const line of collateralLines) {
      expect(line.decimals).to.equal(8n);
    }

    // Sanity: any fxUSD lines should still carry decimals = 18.
    const fxUSDLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter(l => l.tokenAddress.toLowerCase() === fxUSD.toLowerCase());

    for (const line of fxUSDLines) {
      expect(line.decimals).to.equal(18n);
    }

    // Partial close: NFT survives operate() and shields back. Tightened
    // from a `length > 0` smoke check (Task 5) to the exact contract:
    // outputNFTs has the position NFT; spentNFTs is empty.
    expect(output.outputNFTs).to.have.length(1);
    expect(output.outputNFTs[0]?.nftAddress).to.equal(wbtcPool.address);
    expect(output.outputNFTs[0]?.tokenSubID).to.equal(
      '0x' + positionId.toString(16),
    );
    expect(output.spentNFTs ?? []).to.have.length(0);
  });

  it('full-close (partialClose=false) still produces valid output for WBTC-Long', async () => {
    const wbtcPool = resolvePool('WBTC-Long');

    const step = new FxMintClosePositionStep({
      pool: wbtcPool,
      positionId,
      repayAmount,
      withdrawColl,
      withdrawFeeRatio: 0n, // long pool
      partialClose: false,
    });

    const output = await step.getValidStepOutput(
      makeStepInput(wbtcPool.address),
    );

    // Should produce at least one output/spent line for the WBTC collateral, all with decimals=8.
    const collateralLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter(
      l =>
        l.tokenAddress.toLowerCase() === wbtcPool.collateralToken.toLowerCase(),
    );
    expect(collateralLines).to.have.length.greaterThan(0);
    for (const line of collateralLines) {
      expect(line.decimals).to.equal(8n);
    }

    // Full close does NOT burn: f(x) leaves the position NFT alive and owned,
    // holding nothing. So the handle is an output on both branches and is never
    // spent. This asserted the reverse when written, which is why a successful
    // full close carried no shield request for a token that still existed.
    const outputNFTs = output.outputNFTs ?? [];
    expect(outputNFTs).to.have.length(1);
    expect(outputNFTs[0]?.nftAddress).to.equal(wbtcPool.address);
    expect(outputNFTs[0]?.tokenSubID).to.equal('0x' + positionId.toString(16));
    expect(output.spentNFTs ?? []).to.have.length(0);
  });

  describe('short pools (f(x) v2.1)', () => {
    const stETHShort = resolvePool('stETH-Short');

    // A short closes by repaying the volatile asset to release fxUSD — the
    // mirror of a long. The approved input is therefore wstETH, not fxUSD.
    const shortRepay = 1_000_000_000_000_000_000n; // 1 wstETH
    const shortApprove = shortRepay; // shorts charge zero repay fee today
    const shortWithdrawGross = 5_000_000_000_000_000_000_000n; // 5000 fxUSD

    function makeShortStepInput(): StepInput {
      return {
        networkName: NetworkName.Ethereum,
        erc20Amounts: [
          {
            tokenAddress: stETHShort.debtToken,
            decimals: 18n,
            isBaseToken: false,
            expectedBalance: shortApprove,
            minBalance: shortApprove,
            approvedSpender: FX_ADDRESSES.fxShortPoolManager,
          },
        ],
        nfts: [
          {
            nftAddress: stETHShort.address,
            tokenSubID: '0x' + positionId.toString(16),
            nftTokenType: NFTTokenType.ERC721,
            amount: 1n,
          },
        ],
      };
    }

    it('spends the debt token and outputs collateral NET of the withdraw fee', async () => {
      const step = new FxMintClosePositionStep({
        pool: stETHShort,
        positionId,
        repayAmount: shortRepay,
        withdrawColl: shortWithdrawGross,
        withdrawFeeRatio: 1_000_000n, // 0.1%, the measured mainnet short value
        partialClose: true,
      });

      const output = await step.getValidStepOutput(makeShortStepInput());

      expect(output.crossContractCalls[0].to.toLowerCase()).to.equal(
        FX_ADDRESSES.fxShortPoolManager.toLowerCase(),
      );

      // Repays wstETH, not fxUSD.
      expect(output.spentERC20Amounts).to.deep.equal([
        {
          tokenAddress: stETHShort.debtToken,
          decimals: 18n,
          amount: shortRepay,
          recipient: FX_ADDRESSES.fxShortPoolManager,
        },
      ]);

      // The withdraw fee comes out of the caller's proceeds, so the declared
      // output must be 99.9% of the gross — declaring the gross would
      // over-state the reshielded balance and fail accounting on-chain.
      const collOut = output.outputERC20Amounts.find(
        o =>
          o.tokenAddress.toLowerCase() ===
          stETHShort.collateralToken.toLowerCase(),
      );
      if (!collOut) {
        throw new Error('expected an fxUSD collateral output');
      }
      expect(collOut.expectedBalance).to.equal(4_995_000_000_000_000_000_000n);
      expect(collOut.expectedBalance).to.not.equal(shortWithdrawGross);
      // Still deterministic, so a downstream 0x approve can consume it.
      expect(collOut.minBalance).to.equal(collOut.expectedBalance);
    });

    it('rejects an omitted withdrawFeeRatio instead of silently defaulting to 0n', () => {
      // This test used to assert the opposite — that omitting the field on a
      // SHORT pool "reproduces long behaviour (gross == net)". That behaviour
      // was the defect: it over-declares the reshielded collateral by 0.1%, and
      // nothing downstream catches it. The step validator only reconciles
      // tokens present in the step's INPUT, and the collateral is an output, so
      // the over-declaration is invisible there. On the combo path it becomes a
      // 0x sell order for more fxUSD than the executor holds; that call reverts,
      // relay-adapt runs with requireSuccess = false, and the batch mines with
      // the collateral stranded at the executor.
      //
      // TS callers can no longer express this — the cast is what a plain-JS
      // caller reaches the constructor with.
      expect(
        () =>
          new FxMintClosePositionStep({
            pool: stETHShort,
            positionId,
            repayAmount: shortRepay,
            withdrawColl: shortWithdrawGross,
            partialClose: true,
          } as unknown as ConstructorParameters<
            typeof FxMintClosePositionStep
          >[0]),
      ).to.throw(/withdrawFeeRatio/);
    });

    it('treats an explicit 0n as no fee, so long semantics stay reachable', async () => {
      const step = new FxMintClosePositionStep({
        pool: stETHShort,
        positionId,
        repayAmount: shortRepay,
        withdrawColl: shortWithdrawGross,
        withdrawFeeRatio: 0n,
        partialClose: true,
      });
      const output = await step.getValidStepOutput(makeShortStepInput());
      const collOut = output.outputERC20Amounts.find(
        o =>
          o.tokenAddress.toLowerCase() ===
          stETHShort.collateralToken.toLowerCase(),
      );
      if (!collOut) {
        throw new Error('expected an fxUSD collateral output');
      }
      expect(collOut.expectedBalance).to.equal(shortWithdrawGross);
    });
  });
});
