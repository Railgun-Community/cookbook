import chai from 'chai';
import { FxMintOpenPositionStep } from '../fx-mint-open-position-step';
import { FEE_DENOM, FX_ADDRESSES, resolvePool } from '../fx-mint-util';
import { NetworkName, NFTTokenType } from '@railgun-community/shared-models';
import type { StepInput } from '../../../../models/export-models';

const { expect } = chai;

describe('FxMintOpenPositionStep', () => {
  const wstETHPool = resolvePool('wstETH-Long');
  const wbtcPool = resolvePool('WBTC-Long');

  const targetDebt = 5_000_000_000_000_000_000n; // 5 fxUSD
  const predictedPositionId = 1903n;

  function makeStepInput(collateralAmount: bigint, decimals: bigint, collateralToken: string): StepInput {
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
      pool: wstETHPool.address,
      collateralToken: wstETHPool.collateralToken,
      collateralDecimals: wstETHPool.collateralDecimals,
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
    expect(output.crossContractCalls[0].to.toLowerCase())
      .to.equal(FX_ADDRESSES.fxPoolManager.toLowerCase());

    // outputERC20Amounts: fxUSD post-borrow-fee net.
    const expectedFxUSDNet = targetDebt - (targetDebt * 5_000_000n) / FEE_DENOM;
    expect(output.outputERC20Amounts).to.have.length(1);
    expect(output.outputERC20Amounts[0].tokenAddress.toLowerCase())
      .to.equal(FX_ADDRESSES.fxUSD.toLowerCase());
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(expectedFxUSDNet);

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
      pool: wbtcPool.address,
      collateralToken: wbtcPool.collateralToken,
      collateralDecimals: wbtcPool.collateralDecimals,
      targetDebt,
      predictedPositionId,
      borrowFeeRatio: 7_500_000n, // pretend governance moved it to 0.75%
    });

    const collateralAmount = 100_000n; // 0.001 WBTC at 8 decimals
    const output = await step.getValidStepOutput(
      makeStepInput(collateralAmount, 8n, wbtcPool.collateralToken),
    );

    // Net = targetDebt × (1e9 - 7.5e6) / 1e9 = 5e18 × 0.9925 = 4.9625e18
    expect(output.outputERC20Amounts[0].expectedBalance)
      .to.equal(4_962_500_000_000_000_000n);

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
});
