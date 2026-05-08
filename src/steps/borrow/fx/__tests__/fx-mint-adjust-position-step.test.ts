import chai from 'chai';
import { FxMintAdjustPositionStep } from '../fx-mint-adjust-position-step';
import { resolvePool, FX_ADDRESSES } from '../fx-mint-util';
import { NetworkName, NFTTokenType } from '@railgun-community/shared-models';
import type { StepInput } from '../../../../models/export-models';

const { expect } = chai;

describe('FxMintAdjustPositionStep', () => {
  const pool = resolvePool('wstETH-Long');
  const positionId = 1903n;

  const baseData = {
    pool: pool.address,
    collateralToken: pool.collateralToken,
    collateralDecimals: pool.collateralDecimals,
    positionId,
  };

  function inputWithCollateral(amount: bigint): StepInput {
    return {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: pool.collateralToken,
          decimals: pool.collateralDecimals,
          isBaseToken: false,
          expectedBalance: amount,
          minBalance: amount,
          approvedSpender: undefined,
        },
      ],
      nfts: [
        {
          nftAddress: pool.address,
          tokenSubID: '0x' + positionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };
  }

  function inputWithFxUSD(amount: bigint): StepInput {
    return {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress: FX_ADDRESSES.fxUSD,
          decimals: 18n,
          isBaseToken: false,
          expectedBalance: amount,
          minBalance: amount,
          approvedSpender: undefined,
        },
      ],
      nfts: [
        {
          nftAddress: pool.address,
          tokenSubID: '0x' + positionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };
  }

  it('topup (collDelta>0, debtDelta=0): consumes collateral, returns NFT, no fxUSD output', async () => {
    const collDelta = 4_000_000_000_000_000n;
    const step = new FxMintAdjustPositionStep({
      ...baseData,
      collDelta,
      debtDelta: 0n,
    });

    const output = await step.getValidStepOutput(inputWithCollateral(collDelta));

    expect(output.crossContractCalls).to.have.length(1);
    expect(output.spentERC20Amounts).to.have.length(1);
    expect(output.spentERC20Amounts![0].amount).to.equal(collDelta);
    expect(output.outputERC20Amounts ?? []).to.have.length(0);
    expect(output.outputNFTs).to.have.length(1);
    expect(output.outputNFTs![0].tokenSubID).to.equal('0x' + positionId.toString(16));
  });

  it('borrow-more (collDelta=0, debtDelta>0): no collateral spend, fxUSD output post-borrow-fee', async () => {
    const debtDelta = 5_000_000_000_000_000_000n;
    const step = new FxMintAdjustPositionStep({
      ...baseData,
      collDelta: 0n,
      debtDelta,
      borrowFeeRatio: 5_000_000n, // 0.5%
    });

    // No collateral input needed for pure borrow-more.
    const stepInput: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [],
      nfts: [
        {
          nftAddress: pool.address,
          tokenSubID: '0x' + positionId.toString(16),
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
    };

    const output = await step.getValidStepOutput(stepInput);

    expect(output.spentERC20Amounts ?? []).to.have.length(0);
    expect(output.outputERC20Amounts).to.have.length(1);
    expect(output.outputERC20Amounts![0].tokenAddress.toLowerCase())
      .to.equal(FX_ADDRESSES.fxUSD.toLowerCase());
    const expectedNet = debtDelta - (debtDelta * 5_000_000n) / 1_000_000_000n;
    expect(output.outputERC20Amounts![0].expectedBalance).to.equal(expectedNet);
    expect(output.outputNFTs).to.have.length(1);
  });

  it('topup-and-borrow (collDelta>0, debtDelta>0): both legs', async () => {
    const collDelta = 4_000_000_000_000_000n;
    const debtDelta = 2_000_000_000_000_000_000n;
    const step = new FxMintAdjustPositionStep({
      ...baseData,
      collDelta,
      debtDelta,
      borrowFeeRatio: 5_000_000n,
    });

    const output = await step.getValidStepOutput(inputWithCollateral(collDelta));

    expect(output.spentERC20Amounts).to.have.length(1);
    expect(output.outputERC20Amounts).to.have.length(1);
    expect(output.outputNFTs).to.have.length(1);
  });

  it('repay (collDelta=0, debtDelta<0): consumes fxUSD with fee uplift, no collateral output', async () => {
    const debtDelta = -3_000_000_000_000_000_000n;
    const step = new FxMintAdjustPositionStep({
      ...baseData,
      collDelta: 0n,
      debtDelta,
      repayFeeRatio: 5_000_000n,
    });

    // Input fxUSD must equal the approve amount the recipe's preceding
    // ApproveERC20SpenderStep authorizes — namely |debtDelta| × (1e9 + repayFeeRatio)/1e9.
    // PoolManager pulls exactly that amount; cookbook's amount-balance
    // validator requires input == spent + fees + outputs.
    const fxUSDPulled = 3_015_000_000_000_000_000n; // |3e18| × (1e9 + 5e6)/1e9
    const output = await step.getValidStepOutput(inputWithFxUSD(fxUSDPulled));

    // fxUSD spend = |debtDelta| × (1e9 + 5e6) / 1e9 = 3.015e18
    expect(output.spentERC20Amounts).to.have.length(1);
    expect(output.spentERC20Amounts![0].tokenAddress.toLowerCase())
      .to.equal(FX_ADDRESSES.fxUSD.toLowerCase());
    expect(output.spentERC20Amounts![0].amount).to.equal(3_015_000_000_000_000_000n);

    expect(output.outputERC20Amounts ?? []).to.have.length(0);
    expect(output.outputNFTs).to.have.length(1);
  });

  it('throws when both deltas are zero', () => {
    expect(() => new FxMintAdjustPositionStep({
      ...baseData,
      collDelta: 0n,
      debtDelta: 0n,
    })).to.throw(/at least one of/);
  });

  it('throws when debtDelta>0 and borrowFeeRatio missing', () => {
    expect(() => new FxMintAdjustPositionStep({
      ...baseData,
      collDelta: 0n,
      debtDelta: 1n,
    })).to.throw(/borrowFeeRatio/);
  });

  it('throws when debtDelta<0 and repayFeeRatio missing', () => {
    expect(() => new FxMintAdjustPositionStep({
      ...baseData,
      collDelta: 0n,
      debtDelta: -1n,
    })).to.throw(/repayFeeRatio/);
  });
});
