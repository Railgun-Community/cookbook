import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../models/export-models';
import {
  MorphoSupplyCollateralQuote,
  MorphoBorrowQuote,
  MorphoRepayQuote,
  MorphoWithdrawCollateralQuote,
} from '../../../api/morpho';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
  getMarketId,
} from '../morpho-blue-util';
import { MorphoBlueSupplyCollateralStep } from '../blue-supply-collateral-step';
import { MorphoBlueBorrowStep } from '../blue-borrow-step';
import { MorphoBlueRepayStep } from '../blue-repay-step';
import { MorphoBlueWithdrawCollateralStep } from '../blue-withdraw-collateral-step';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const onBehalf = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

// Real mainnet Morpho Blue market (USDC loan / PAXG collateral), used as a
// known-answer test for getMarketId.
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'; // pragma: allowlist secret
const ORACLE = '0xDd1778F71a4a1C6A0eFebd8AE9f8848634CE1101'; // pragma: allowlist secret
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC'; // pragma: allowlist secret
const MARKET_ID =
  '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9';

const market: MarketParams = {
  loanToken: USDC,
  collateralToken: PAXG,
  oracle: ORACLE,
  irm: IRM,
  lltv: 915000000000000000n,
};

describe('morpho-blue-util', () => {
  it('Should derive the market id matching the on-chain value', () => {
    expect(getMarketId(market).toLowerCase()).to.equal(MARKET_ID);
  });
});

describe('morpho-blue-supply-collateral-step', () => {
  it('Should spend collateral, emit supplyCollateral, pass change through', async () => {
    const quote: MorphoSupplyCollateralQuote = {
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      collateralAssets: 1_000_000_000_000_000_000n,
      onBehalf,
    };
    const step = new MorphoBlueSupplyCollateralStep(quote);
    const stepInput: StepInput = {
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
    };
    const output = await step.getValidStepOutput(stepInput);
    expect(output.crossContractCalls.length).to.equal(1);
    expect(output.spentERC20Amounts).to.deep.equal([
      { tokenAddress: PAXG, decimals: 18n, amount: 1_000_000_000_000_000_000n, recipient: 'Morpho Blue Market' },
    ]);
    // Collateral change passes through; no position token output.
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: PAXG,
        decimals: 18n,
        expectedBalance: 1_000_000_000_000_000_000n,
        minBalance: 1_000_000_000_000_000_000n,
        approvedSpender: MORPHO_BLUE_ADDRESS,
      },
    ]);
  });

  it('Should reject collateral not approved for Morpho Blue', async () => {
    const quote: MorphoSupplyCollateralQuote = {
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      collateralAssets: 1_000_000_000_000_000_000n,
      onBehalf,
    };
    const step = new MorphoBlueSupplyCollateralStep(quote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: PAXG,
          decimals: 18n,
          expectedBalance: 1_000_000_000_000_000_000n,
          minBalance: 1_000_000_000_000_000_000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInput)).to.be.rejected;
  });
});

describe('morpho-blue-borrow-step', () => {
  it('Should emit borrow and output the deterministic loan token', async () => {
    const quote: MorphoBorrowQuote = {
      params: market,
      marketId: MARKET_ID,
      loanToken: USDC,
      loanDecimals: 6n,
      borrowAssets: 1_000_000_000n, // 1000 USDC
      onBehalf,
      receiver: onBehalf,
    };
    const step = new MorphoBlueBorrowStep(quote);
    const stepInput: StepInput = { networkName, erc20Amounts: [], nfts: [] };
    const output = await step.getValidStepOutput(stepInput);
    expect(output.crossContractCalls.length).to.equal(1);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: USDC,
        decimals: 6n,
        expectedBalance: 1_000_000_000n,
        minBalance: 1_000_000_000n,
        approvedSpender: undefined,
      },
    ]);
  });
});

describe('morpho-blue-repay-step', () => {
  it('Should spend loan token, emit repay, pass change through', async () => {
    const quote: MorphoRepayQuote = {
      params: market,
      marketId: MARKET_ID,
      loanToken: USDC,
      loanDecimals: 6n,
      repayAssets: 500_000_000n,
      onBehalf,
    };
    const step = new MorphoBlueRepayStep(quote);
    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC,
          decimals: 6n,
          expectedBalance: 1_000_000_000n,
          minBalance: 1_000_000_000n,
          approvedSpender: MORPHO_BLUE_ADDRESS,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);
    expect(output.crossContractCalls.length).to.equal(1);
    const spent = output.spentERC20Amounts ?? [];
    expect(spent[0]?.amount).to.equal(500_000_000n);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: USDC,
        decimals: 6n,
        expectedBalance: 500_000_000n,
        minBalance: 500_000_000n,
        approvedSpender: MORPHO_BLUE_ADDRESS,
      },
    ]);
  });
});

describe('morpho-blue-withdraw-collateral-step', () => {
  it('Should emit withdrawCollateral and output the deterministic collateral', async () => {
    const quote: MorphoWithdrawCollateralQuote = {
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      withdrawAssets: 500_000_000_000_000_000n,
      onBehalf,
      receiver: onBehalf,
    };
    const step = new MorphoBlueWithdrawCollateralStep(quote);
    const stepInput: StepInput = { networkName, erc20Amounts: [], nfts: [] };
    const output = await step.getValidStepOutput(stepInput);
    expect(output.crossContractCalls.length).to.equal(1);
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: PAXG,
        decimals: 18n,
        expectedBalance: 500_000_000_000_000_000n,
        minBalance: 500_000_000_000_000_000n,
        approvedSpender: undefined,
      },
    ]);
  });
});
