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
      pool: wbtcPool.address,
      collateralToken: wbtcPool.collateralToken,
      collateralDecimals: wbtcPool.collateralDecimals, // 8n
      positionId,
      repayAmount,
      withdrawColl,
      partialClose: true,
    });

    const output = await step.getValidStepOutput(makeStepInput(wbtcPool.address));

    // Every output/spent line referencing the WBTC collateral must carry decimals = 8.
    const collateralLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter(
      (l) => l.tokenAddress.toLowerCase() === wbtcPool.collateralToken.toLowerCase(),
    );

    expect(collateralLines).to.have.length.greaterThan(0);
    for (const line of collateralLines) {
      expect(line.decimals).to.equal(8n);
    }

    // Sanity: any fxUSD lines should still carry decimals = 18.
    const fxUSDLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter((l) => l.tokenAddress.toLowerCase() === fxUSD.toLowerCase());

    for (const line of fxUSDLines) {
      expect(line.decimals).to.equal(18n);
    }

    // Partial close: NFT survives operate() and shields back. Tightened
    // from a `length > 0` smoke check (Task 5) to the exact contract:
    // outputNFTs has the position NFT; spentNFTs is empty.
    expect(output.outputNFTs).to.have.length(1);
    expect(output.outputNFTs[0]?.nftAddress).to.equal(wbtcPool.address);
    expect(output.outputNFTs[0]?.tokenSubID).to.equal('0x' + positionId.toString(16));
    expect(output.spentNFTs ?? []).to.have.length(0);
  });

  it('full-close (partialClose=false) still produces valid output for WBTC-Long', async () => {
    const wbtcPool = resolvePool('WBTC-Long');

    const step = new FxMintClosePositionStep({
      pool: wbtcPool.address,
      collateralToken: wbtcPool.collateralToken,
      collateralDecimals: wbtcPool.collateralDecimals,
      positionId,
      repayAmount,
      withdrawColl,
      partialClose: false,
    });

    const output = await step.getValidStepOutput(makeStepInput(wbtcPool.address));

    // Should produce at least one output/spent line for the WBTC collateral, all with decimals=8.
    const collateralLines = [
      ...(output.outputERC20Amounts ?? []),
      ...(output.spentERC20Amounts ?? []),
    ].filter(
      (l) => l.tokenAddress.toLowerCase() === wbtcPool.collateralToken.toLowerCase(),
    );
    expect(collateralLines).to.have.length.greaterThan(0);
    for (const line of collateralLines) {
      expect(line.decimals).to.equal(8n);
    }

    // Full close: PoolManager.operate burns the NFT inside the call, so
    // the step must declare the NFT as spent (consumed) and outputNFTs is
    // empty. Tightened from Task 5's `length > 0` smoke check.
    expect(output.outputNFTs ?? []).to.have.length(0);
    const spentNFTs = output.spentNFTs ?? [];
    expect(spentNFTs).to.have.length(1);
    expect(spentNFTs[0]?.nftAddress).to.equal(wbtcPool.address);
    expect(spentNFTs[0]?.tokenSubID).to.equal('0x' + positionId.toString(16));
  });
});
