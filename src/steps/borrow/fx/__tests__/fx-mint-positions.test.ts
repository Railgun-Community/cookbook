import chai from 'chai';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import type {
  RecipeBearerPosition,
  StepInput,
} from '../../../../models/export-models';
import { FxMintOpenPositionStep } from '../fx-mint-open-position-step';
import { FxMintAdjustPositionStep } from '../fx-mint-adjust-position-step';
import { FxMintClosePositionStep } from '../fx-mint-close-position-step';
import {
  fxCollateralPositionCredit,
  fxCollateralSupplySpend,
  resolvePool,
} from '../fx-mint-util';

const { expect } = chai;

const networkName = NetworkName.Ethereum;

// Long: fee-free on the collateral axis. Short: 0.3% supply, 0.1% withdraw —
// the pair that makes "what the caller pays" and "what the position gets"
// different numbers.
const wbtcLong = resolvePool('WBTC-Long');
const wbtcShort = resolvePool('WBTC-Short');

const LONG_BORROW_FEE = 5_000_000n; // 0.5%, mainnet
const SHORT_SUPPLY_FEE = 3_000_000n; // 0.3%, mainnet
const SHORT_WITHDRAW_FEE = 1_000_000n; // 0.1%, mainnet

const positionId = 1903n;
const TOKEN_SUB_ID = '0x76f';

const erc20Input = (
  tokenAddress: string,
  decimals: bigint,
  amount: bigint,
  approvedSpender?: string,
): StepInput['erc20Amounts'][number] => ({
  tokenAddress,
  decimals,
  isBaseToken: false,
  expectedBalance: amount,
  minBalance: amount,
  approvedSpender,
});

const positionNFT = (nftAddress: string) => ({
  nftAddress,
  tokenSubID: TOKEN_SUB_ID,
  nftTokenType: NFTTokenType.ERC721,
  amount: 1n,
});

/**
 * f(x) positions are bearer, so every record must carry the NFT handle and
 * none may carry an owner. Narrowed once here.
 */
const onlyBearer = (positions: unknown): RecipeBearerPosition[] => {
  const list = (positions ?? []) as RecipeBearerPosition[];
  list.forEach(position => {
    expect(position.custody).to.equal('bearer');
    expect(position.nftTokenType).to.equal(NFTTokenType.ERC721);
    expect(position).to.not.have.property('owner');
  });
  return list;
};

const legOf = (positions: RecipeBearerPosition[], kind: string) => {
  const found = positions.filter(position => position.kind === kind);
  expect(found, `expected exactly one ${kind} record`).to.have.length(1);
  return found[0];
};

describe('f(x) outputPositions — open', () => {
  it('Should declare gross debt and net-of-supply-fee collateral', async () => {
    const collateral = 100_000_000n; // 1 WBTC (8dp)
    const targetDebt = 5_000_000_000_000_000_000n;

    const output = await new FxMintOpenPositionStep({
      pool: wbtcLong,
      targetDebt,
      predictedPositionId: positionId,
      borrowFeeRatio: LONG_BORROW_FEE,
      supplyFeeRatio: 0n,
    }).getValidStepOutput({
      networkName,
      erc20Amounts: [
        erc20Input(wbtcLong.collateralToken, 8n, collateral, wbtcLong.poolManager),
      ],
      nfts: [],
    });

    const positions = onlyBearer(output.outputPositions);
    expect(positions).to.have.length(2);

    const collateralLeg = legOf(positions, 'collateral');
    expect(collateralLeg.direction).to.equal('increase');
    expect(collateralLeg.tokenAddress).to.equal(wbtcLong.collateralToken);
    expect(collateralLeg.decimals).to.equal(8n);
    expect(collateralLeg.amount).to.equal(collateral); // no supply fee on longs
    expect(collateralLeg.estimateReason).to.equal(undefined);

    // The debt record is the GROSS operate() argument; the caller is paid the
    // net, which is what outputERC20Amounts carries. The two must differ by
    // exactly the borrow fee, or one of them is reporting the other's number.
    const debtLeg = legOf(positions, 'debt');
    expect(debtLeg.direction).to.equal('increase');
    expect(debtLeg.tokenAddress).to.equal(wbtcLong.debtToken);
    expect(debtLeg.decimals).to.equal(18n);
    expect(debtLeg.amount).to.equal(targetDebt);

    const debtOutput = output.outputERC20Amounts.find(
      amount => amount.tokenAddress === wbtcLong.debtToken,
    );
    expect((debtOutput?.expectedBalance ?? 0n) < debtLeg.amount).to.equal(true);
    expect(debtLeg.amount - (debtOutput?.expectedBalance ?? 0n)).to.equal(
      (targetDebt * LONG_BORROW_FEE) / 1_000_000_000n,
    );

    // Both records point at the same NFT the step declares, so the validator's
    // bearer cross-check is exercised on the real output rather than a stub.
    expect(output.outputNFTs[0].tokenSubID).to.equal(TOKEN_SUB_ID);
    positions.forEach(position => {
      expect(position.nftAddress).to.equal(wbtcLong.address);
      expect(position.tokenSubID).to.equal(TOKEN_SUB_ID);
      expect(position.marketOrPoolId).to.equal(wbtcLong.address);
    });
  });

  it('Should credit a short position net of the 0.3% supply fee', async () => {
    // The case the ERC20 channel cannot see: the manager pulls the full amount
    // (so `spentERC20Amounts` is the gross) but credits the position less.
    const collateral = 1_000_000_000_000_000_000_000n; // 1000 fxUSD

    const output = await new FxMintOpenPositionStep({
      pool: wbtcShort,
      targetDebt: 1_000_000n,
      predictedPositionId: positionId,
      borrowFeeRatio: 0n,
      supplyFeeRatio: SHORT_SUPPLY_FEE,
    }).getValidStepOutput({
      networkName,
      erc20Amounts: [
        erc20Input(
          wbtcShort.collateralToken,
          18n,
          collateral,
          wbtcShort.poolManager,
        ),
      ],
      nfts: [],
    });

    const collateralLeg = legOf(
      onlyBearer(output.outputPositions),
      'collateral',
    );
    expect(collateralLeg.amount).to.equal(
      fxCollateralPositionCredit(collateral, SHORT_SUPPLY_FEE),
    );
    expect(collateralLeg.amount).to.equal(997_000_000_000_000_000_000n);
    // Caller's outlay is unchanged by the fee — that asymmetry is the whole
    // reason this channel cannot reuse the spent amount.
    expect(output.spentERC20Amounts?.[0]?.amount).to.equal(
      fxCollateralSupplySpend(collateral),
    );
    expect(collateralLeg.estimateReason).to.equal(undefined);
  });

  it('Should flag the collateral record as an upper bound with no supplyFeeRatio', async () => {
    const collateral = 1_000_000_000_000_000_000_000n;

    const output = await new FxMintOpenPositionStep({
      pool: wbtcShort,
      targetDebt: 1_000_000n,
      predictedPositionId: positionId,
      borrowFeeRatio: 0n,
    }).getValidStepOutput({
      networkName,
      erc20Amounts: [
        erc20Input(
          wbtcShort.collateralToken,
          18n,
          collateral,
          wbtcShort.poolManager,
        ),
      ],
      nfts: [],
    });

    const collateralLeg = legOf(
      onlyBearer(output.outputPositions),
      'collateral',
    );
    expect(collateralLeg.amount).to.equal(collateral);
    expect(collateralLeg.estimateReason).to.be.a('string');
    expect(collateralLeg.estimateReason).to.contain('supplyFeeRatio');
  });

  it('Should declare the clamped collateral, not the optimistic balance', async () => {
    // operate() pulls minBalance on a non-deterministic upstream, so a position
    // record built from expectedBalance would over-state the position by the
    // whole slippage band.
    const step = new FxMintOpenPositionStep({
      pool: wbtcLong,
      targetDebt: 1_000_000_000_000_000_000n,
      predictedPositionId: positionId,
      borrowFeeRatio: LONG_BORROW_FEE,
      supplyFeeRatio: 0n,
    });
    const output = await step.getValidStepOutput({
      networkName,
      erc20Amounts: [
        {
          tokenAddress: wbtcLong.collateralToken,
          decimals: 8n,
          isBaseToken: false,
          expectedBalance: 100_000_000n,
          minBalance: 99_000_000n,
          approvedSpender: wbtcLong.poolManager,
        },
      ],
      nfts: [],
    });

    expect(
      legOf(onlyBearer(output.outputPositions), 'collateral').amount,
    ).to.equal(99_000_000n);
  });
});

describe('f(x) outputPositions — adjust', () => {
  const adjustInput = (
    erc20Amounts: StepInput['erc20Amounts'],
  ): StepInput => ({
    networkName,
    erc20Amounts,
    nfts: [positionNFT(wbtcLong.address)],
  });

  it('Should emit one record per axis moved (lever-up)', async () => {
    const output = await new FxMintAdjustPositionStep({
      pool: wbtcLong,
      positionId,
      collDelta: 50_000_000n,
      debtDelta: 2_000_000_000_000_000_000n,
      borrowFeeRatio: LONG_BORROW_FEE,
      supplyFeeRatio: 0n,
    }).getValidStepOutput(
      adjustInput([
        erc20Input(
          wbtcLong.collateralToken,
          8n,
          50_000_000n,
          wbtcLong.poolManager,
        ),
      ]),
    );

    const positions = onlyBearer(output.outputPositions);
    expect(positions).to.have.length(2);
    expect(legOf(positions, 'collateral').direction).to.equal('increase');
    expect(legOf(positions, 'collateral').amount).to.equal(50_000_000n);
    expect(legOf(positions, 'debt').direction).to.equal('increase');
    expect(legOf(positions, 'debt').amount).to.equal(
      2_000_000_000_000_000_000n,
    );
  });

  it('Should report a withdrawal GROSS, unlike the ERC20 output', async () => {
    const withdrawGross = 100_000_000_000_000_000_000n; // 100 fxUSD collateral
    const output = await new FxMintAdjustPositionStep({
      pool: wbtcShort,
      positionId,
      collDelta: -withdrawGross,
      debtDelta: 0n,
      withdrawFeeRatio: SHORT_WITHDRAW_FEE,
    }).getValidStepOutput({
      networkName,
      erc20Amounts: [],
      nfts: [positionNFT(wbtcShort.address)],
    });

    const collateralLeg = legOf(
      onlyBearer(output.outputPositions),
      'collateral',
    );
    expect(collateralLeg.direction).to.equal('decrease');
    // The position gives up the gross; the caller receives it minus 0.1%.
    expect(collateralLeg.amount).to.equal(withdrawGross);
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(
      99_900_000_000_000_000_000n,
    );
  });

  it('Should report a repay as the principal, not principal + fee', async () => {
    const repayFeeRatio = 2_000_000n; // 0.2%
    const debtDelta = -1_000_000_000_000_000_000n;
    const output = await new FxMintAdjustPositionStep({
      pool: wbtcLong,
      positionId,
      collDelta: 0n,
      debtDelta,
      repayFeeRatio,
    }).getValidStepOutput(
      adjustInput([
        erc20Input(
          wbtcLong.debtToken,
          18n,
          1_002_000_000_000_000_000n,
          wbtcLong.poolManager,
        ),
      ]),
    );

    const debtLeg = legOf(onlyBearer(output.outputPositions), 'debt');
    expect(debtLeg.direction).to.equal('decrease');
    expect(debtLeg.amount).to.equal(-debtDelta);
    // The caller parts with principal + fee; only the principal clears debt.
    expect(output.spentERC20Amounts?.[0]?.amount).to.equal(
      1_002_000_000_000_000_000n,
    );
  });
});

describe('f(x) outputPositions — close', () => {
  const closeInput = (approveAmount: bigint): StepInput => ({
    networkName,
    erc20Amounts: [
      erc20Input(
        wbtcShort.debtToken,
        8n,
        approveAmount,
        wbtcShort.poolManager,
      ),
    ],
    nfts: [positionNFT(wbtcShort.address)],
  });

  it('Should retire both legs on a full close, keyed to the surviving NFT', async () => {
    const repayAmount = 100_000_000n;
    const withdrawColl = 1_000_000_000_000_000_000_000n;

    const output = await new FxMintClosePositionStep({
      pool: wbtcShort,
      positionId,
      repayAmount,
      withdrawColl,
      withdrawFeeRatio: SHORT_WITHDRAW_FEE,
      partialClose: false,
    }).getValidStepOutput(closeInput(repayAmount));

    const positions = onlyBearer(output.outputPositions);
    expect(positions).to.have.length(2);
    expect(legOf(positions, 'debt').amount).to.equal(repayAmount);
    expect(legOf(positions, 'collateral').amount).to.equal(withdrawColl);
    positions.forEach(position => {
      expect(position.direction).to.equal('decrease');
    });

    // The NFT is not burned, so the handle comes back as an output. The
    // position records above are what describe the retirement — the surviving
    // NFT does not, since it reads (0, 0) and outlives the position.
    expect(output.outputNFTs?.[0]?.tokenSubID).to.equal(TOKEN_SUB_ID);
    expect(output.spentNFTs ?? []).to.deep.equal([]);
  });

  it('Should keep the collateral record gross of the withdraw fee', async () => {
    const withdrawColl = 1_000_000_000_000_000_000_000n;
    const output = await new FxMintClosePositionStep({
      pool: wbtcShort,
      positionId,
      repayAmount: 50_000_000n,
      withdrawColl,
      withdrawFeeRatio: SHORT_WITHDRAW_FEE,
      partialClose: true,
    }).getValidStepOutput(closeInput(50_000_000n));

    expect(
      legOf(onlyBearer(output.outputPositions), 'collateral').amount,
    ).to.equal(withdrawColl);
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(
      999_000_000_000_000_000_000n,
    );
  });
});
