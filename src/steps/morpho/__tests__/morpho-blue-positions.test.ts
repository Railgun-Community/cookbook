import chai from 'chai';
import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeAddressBoundPosition,
  StepInput,
} from '../../../models/export-models';
import {
  MorphoBorrowQuote,
  MorphoRepayQuote,
  MorphoRepaySharesQuote,
  MorphoSupplyCollateralQuote,
  MorphoWithdrawCollateralQuote,
} from '../../../api/morpho';
import { MarketParams, MORPHO_BLUE_ADDRESS } from '../morpho-blue-util';
import { MorphoBlueSupplyCollateralStep } from '../blue-supply-collateral-step';
import { MorphoBlueBorrowStep } from '../blue-borrow-step';
import { MorphoBlueRepayStep } from '../blue-repay-step';
import { MorphoBlueRepaySharesStep } from '../blue-repay-shares-step';
import { MorphoBlueWithdrawCollateralStep } from '../blue-withdraw-collateral-step';
import { MorphoBlueSetAuthorizationStep } from '../blue-set-authorization-step';

const { expect } = chai;

const networkName = NetworkName.Ethereum;

// The mainnet USDC/PAXG 91.5% market, matching morpho-blue-steps.test.ts.
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'; // pragma: allowlist secret
const ORACLE = '0xDd1778F71a4a1C6A0eFebd8AE9f8848634CE1101'; // pragma: allowlist secret
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC'; // pragma: allowlist secret
const MARKET_ID =
  '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9';

const OWNER = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
// A receiver that is NOT the owner, to prove the record follows `onBehalf`.
const RECEIVER = '0x1111111111111111111111111111111111111111';

const market: MarketParams = {
  loanToken: USDC,
  collateralToken: PAXG,
  oracle: ORACLE,
  irm: IRM,
  lltv: 915000000000000000n,
};

const loanInput = (amount: bigint): StepInput => ({
  networkName,
  erc20Amounts: [
    {
      tokenAddress: USDC,
      decimals: 6n,
      expectedBalance: amount,
      minBalance: amount,
      approvedSpender: MORPHO_BLUE_ADDRESS,
    },
  ],
  nfts: [],
});

/**
 * Every Blue position record is address-bound, so narrowing once here keeps the
 * assertions below readable — and a step that ever emitted a bearer record for
 * an un-tokenized position would fail loudly right here.
 */
const onlyAddressBound = (
  positions: unknown,
): RecipeAddressBoundPosition[] => {
  const list = positions as RecipeAddressBoundPosition[] | undefined;
  expect(list, 'step emitted no outputPositions').to.not.equal(undefined);
  (list ?? []).forEach(position => {
    expect(position.custody).to.equal('address-bound');
  });
  return list ?? [];
};

describe('morpho-blue outputPositions', () => {
  it('Should declare the collateral the supply step creates', async () => {
    const quote: MorphoSupplyCollateralQuote = {
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      collateralAssets: 1_000_000_000_000_000_000n,
      onBehalf: OWNER,
    };
    const output = await new MorphoBlueSupplyCollateralStep(
      quote,
    ).getValidStepOutput({
      networkName,
      erc20Amounts: [
        {
          tokenAddress: PAXG,
          decimals: 18n,
          expectedBalance: 2_000_000_000_000_000_000n,
          minBalance: 2_000_000_000_000_000_000n,
          approvedSpender: MORPHO_BLUE_ADDRESS,
        },
      ],
      nfts: [],
    });

    expect(onlyAddressBound(output.outputPositions)).to.deep.equal([
      {
        protocol: 'morpho-blue',
        marketOrPoolId: MARKET_ID,
        custody: 'address-bound',
        owner: OWNER,
        kind: 'collateral',
        direction: 'increase',
        tokenAddress: PAXG,
        decimals: 18n,
        amount: 1_000_000_000_000_000_000n,
      },
    ]);
  });

  it('Should book borrowed debt against onBehalf, not the receiver', async () => {
    // The one case where the position channel and the ERC20 channel name
    // different accounts: Morpho pays `receiver` but debits `onBehalf`. The
    // shipped builders collapse the two, so this is asserted against a quote
    // where they deliberately differ.
    const quote: MorphoBorrowQuote = {
      params: market,
      marketId: MARKET_ID,
      loanToken: USDC,
      loanDecimals: 6n,
      borrowAssets: 500_000_000n,
      onBehalf: OWNER,
      receiver: RECEIVER,
    };
    const output = await new MorphoBlueBorrowStep(quote).getValidStepOutput({
      networkName,
      erc20Amounts: [],
      nfts: [],
    });

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions).to.have.length(1);
    expect(positions[0].owner).to.equal(OWNER);
    expect(positions[0].owner).to.not.equal(RECEIVER);
    expect(positions[0].kind).to.equal('debt');
    expect(positions[0].direction).to.equal('increase');
    expect(positions[0].tokenAddress).to.equal(USDC);
    expect(positions[0].decimals).to.equal(6n);
    expect(positions[0].amount).to.equal(500_000_000n);
    expect(positions[0].estimateReason).to.equal(undefined);
  });

  it('Should declare an assets-mode repay as an exact debt decrease', async () => {
    const quote: MorphoRepayQuote = {
      params: market,
      marketId: MARKET_ID,
      loanToken: USDC,
      loanDecimals: 6n,
      repayAssets: 500_000_000n,
      onBehalf: OWNER,
    };
    const output = await new MorphoBlueRepayStep(quote).getValidStepOutput(
      loanInput(1_000_000_000n),
    );

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions).to.have.length(1);
    expect(positions[0].kind).to.equal('debt');
    expect(positions[0].direction).to.equal('decrease');
    expect(positions[0].amount).to.equal(500_000_000n);
    expect(positions[0].shares).to.equal(undefined);
    expect(positions[0].estimateReason).to.equal(undefined);
  });

  it('Should report a shares repay as expected assets + exact shares, flagged', async () => {
    const quote: MorphoRepaySharesQuote = {
      params: market,
      marketId: MARKET_ID,
      loanToken: USDC,
      loanDecimals: 6n,
      repayShares: 1_000_000_000_000_000_000n,
      expectedRepaidAssets: 1_000_000_000n,
      maxRepaidAssets: 1_010_000_000n,
      slippageBasisPoints: 100n,
      onBehalf: OWNER,
    };
    const output = await new MorphoBlueRepaySharesStep(
      quote,
    ).getValidStepOutput(loanInput(1_500_000_000n));

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions).to.have.length(1);
    // The step SPENDS the conservative upper bound (it sizes the unshield), but
    // reporting that as the debt reduction would over-state how much of the
    // position was closed.
    expect(output.spentERC20Amounts?.[0]?.amount).to.equal(1_010_000_000n);
    expect(positions[0].amount).to.equal(1_000_000_000n);
    expect(positions[0].shares).to.equal(1_000_000_000_000_000_000n);
    expect(positions[0].estimateReason).to.be.a('string');
  });

  it('Should declare a collateral withdrawal against onBehalf', async () => {
    const quote: MorphoWithdrawCollateralQuote = {
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      withdrawAssets: 250_000_000_000_000_000n,
      onBehalf: OWNER,
      receiver: RECEIVER,
    };
    const output = await new MorphoBlueWithdrawCollateralStep(
      quote,
    ).getValidStepOutput({ networkName, erc20Amounts: [], nfts: [] });

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions).to.have.length(1);
    expect(positions[0].owner).to.equal(OWNER);
    expect(positions[0].kind).to.equal('collateral');
    expect(positions[0].direction).to.equal('decrease');
    expect(positions[0].amount).to.equal(250_000_000_000_000_000n);
  });

  it('Should NOT declare a position for setAuthorization', async () => {
    // An authorization is not a position: it changes who may act, not what is
    // owed or pledged. Emitting a record here would put a zero-amount entry in
    // every retained-account recipe.
    const output = await new MorphoBlueSetAuthorizationStep(
      RECEIVER,
      true,
    ).getValidStepOutput({ networkName, erc20Amounts: [], nfts: [] });

    expect(output.outputPositions ?? []).to.deep.equal([]);
  });
});
