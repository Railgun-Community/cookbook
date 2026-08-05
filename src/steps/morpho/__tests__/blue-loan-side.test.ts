import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Interface } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { MorphoBlueSupplyLoanStep } from '../blue-supply-loan-step';
import { MorphoBlueWithdrawLoanStep } from '../blue-withdraw-loan-step';
import { MORPHO_BLUE_ADDRESS, type MarketParams } from '../morpho-blue-util';
import type {
  MorphoSupplyLoanQuote,
  MorphoWithdrawLoanQuote,
} from '../../../api/morpho';
import type {
  RecipeAddressBoundPosition,
  StepInput,
} from '../../../models/export-models';
import { getStepFailureMode } from '../../failure-modes';
import abi from '../../../abi/morpho/MorphoBlue.json';

chai.use(chaiAsPromised);
const { expect } = chai;

const OWNER = '0x1111111111111111111111111111111111111111';
const RECEIVER = '0x2222222222222222222222222222222222222222';
const LOAN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const MARKET_ID = '0xabc';

// Real mainnet market shape (wstETH/USDC); only the market ID is a stand-in,
// since nothing here recomputes it.
const market: MarketParams = {
  loanToken: LOAN,
  collateralToken: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', // pragma: allowlist secret
  oracle: '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2', // pragma: allowlist secret
  irm: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC', // pragma: allowlist secret
  lltv: 860_000_000_000_000_000n,
};

const iface = new Interface(abi as never);

const supplyQuote = (supplyAssets: bigint): MorphoSupplyLoanQuote => ({
  params: market,
  marketId: MARKET_ID,
  loanToken: LOAN,
  loanDecimals: 6n,
  supplyAssets,
  onBehalf: OWNER,
});

const withdrawQuote = (
  over: Partial<MorphoWithdrawLoanQuote> = {},
): MorphoWithdrawLoanQuote => ({
  params: market,
  marketId: MARKET_ID,
  loanToken: LOAN,
  loanDecimals: 6n,
  withdrawAssets: 1_000_000n,
  withdrawShares: 0n,
  expectedWithdrawnAssets: 1_000_000n,
  availableLiquidity: 50_000_000n,
  onBehalf: OWNER,
  receiver: RECEIVER,
  ...over,
});

const inputWithApprovedLoan = (amount: bigint): StepInput => ({
  networkName: NetworkName.Ethereum,
  erc20Amounts: [
    {
      tokenAddress: LOAN,
      decimals: 6n,
      expectedBalance: amount,
      minBalance: amount,
      approvedSpender: MORPHO_BLUE_ADDRESS,
      isBaseToken: false,
    },
  ],
  nfts: [],
});

/**
 * Every Blue position record is address-bound, so narrowing once keeps the
 * assertions readable — and a step that ever emitted a bearer record for an
 * un-tokenized position fails loudly right here. Mirrors the helper in
 * `morpho-blue-positions.test.ts`.
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

const emptyInput = (): StepInput => ({
  networkName: NetworkName.Ethereum,
  erc20Amounts: [],
  nfts: [],
});

describe('MorphoBlueSupplyLoanStep', () => {
  it('Should encode supply() assets-denominated, with shares zero', async () => {
    const output = await new MorphoBlueSupplyLoanStep(
      supplyQuote(1_000_000n),
    ).getValidStepOutput(inputWithApprovedLoan(1_000_000n));

    expect(output.crossContractCalls).to.have.length(1);
    const decoded = iface.decodeFunctionData(
      'supply',
      output.crossContractCalls[0].data as string,
    );
    // Blue requires EXACTLY one of assets/shares to be non-zero and reverts
    // otherwise — a revert requireSuccess = false would swallow.
    expect(decoded[1]).to.equal(1_000_000n);
    expect(decoded[2]).to.equal(0n);
    expect((decoded[3] as string).toLowerCase()).to.equal(OWNER.toLowerCase());
  });

  it('Should declare the claim as a supply position owned by onBehalf', async () => {
    const output = await new MorphoBlueSupplyLoanStep(
      supplyQuote(1_000_000n),
    ).getValidStepOutput(inputWithApprovedLoan(1_000_000n));

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions).to.have.length(1);
    expect(positions[0].kind).to.equal('supply');
    expect(positions[0].direction).to.equal('increase');
    expect(positions[0].owner).to.equal(OWNER);
    expect(positions[0].tokenAddress).to.equal(LOAN);
    // Un-tokenized: nothing comes back as an ERC-20, so the record is the only
    // description of where the asset went.
    expect(output.outputERC20Amounts).to.deep.equal([]);
  });

  it('Should spend the loan asset rather than output it', async () => {
    const output = await new MorphoBlueSupplyLoanStep(
      supplyQuote(1_000_000n),
    ).getValidStepOutput(inputWithApprovedLoan(1_000_000n));

    expect(output.spentERC20Amounts).to.have.length(1);
    expect(output.spentERC20Amounts?.[0].amount).to.equal(1_000_000n);
  });

  it('Should pass change through when the input exceeds the supply', async () => {
    const output = await new MorphoBlueSupplyLoanStep(
      supplyQuote(400_000n),
    ).getValidStepOutput(inputWithApprovedLoan(1_000_000n));

    expect(output.outputERC20Amounts).to.have.length(1);
    expect(output.outputERC20Amounts[0].expectedBalance).to.equal(600_000n);
  });
});

describe('MorphoBlueWithdrawLoanStep', () => {
  it('Should encode withdraw() assets-denominated', async () => {
    const output = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote(),
    ).getValidStepOutput(emptyInput());

    const decoded = iface.decodeFunctionData(
      'withdraw',
      output.crossContractCalls[0].data as string,
    );
    expect(decoded[1]).to.equal(1_000_000n);
    expect(decoded[2]).to.equal(0n);
    expect((decoded[3] as string).toLowerCase()).to.equal(OWNER.toLowerCase());
    expect((decoded[4] as string).toLowerCase()).to.equal(
      RECEIVER.toLowerCase(),
    );
  });

  it('Should encode withdraw() shares-denominated for a full exit', async () => {
    const output = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote({
        withdrawAssets: 0n,
        withdrawShares: 5_000_000_000_000n,
        expectedWithdrawnAssets: 1_200_000n,
      }),
    ).getValidStepOutput(emptyInput());

    const decoded = iface.decodeFunctionData(
      'withdraw',
      output.crossContractCalls[0].data as string,
    );
    // Shares, not assets: interest accrues between building and inclusion, so
    // an assets-denominated "withdraw everything" leaves a share residue.
    expect(decoded[1]).to.equal(0n);
    expect(decoded[2]).to.equal(5_000_000_000_000n);
  });

  it('Should mark a shares-mode withdrawal as an estimate', async () => {
    const shares = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote({
        withdrawAssets: 0n,
        withdrawShares: 5_000_000_000_000n,
        expectedWithdrawnAssets: 1_200_000n,
      }),
    ).getValidStepOutput(emptyInput());
    const assets = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote(),
    ).getValidStepOutput(emptyInput());

    // The assets figure for a shares exit is a number that grows until
    // inclusion. Saying so beats a precise-looking figure that will be low.
    expect(shares.outputPositions?.[0].estimateReason).to.be.a('string');
    expect(assets.outputPositions?.[0].estimateReason).to.equal(undefined);
  });

  /**
   * `Step.getValidStepOutput` wraps every failure as "<name> step is invalid."
   * and keeps the detail on `cause`. So the diagnosis is reachable but never in
   * the top-level message — assert on the chain, not the surface.
   */
  const causeMessageOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
    } catch (error) {
      const cause = (error as Error).cause;
      return cause instanceof Error ? cause.message : String(cause);
    }
    throw new Error('expected the step to reject');
  };

  it('Should reject a quote with both denominations set', async () => {
    const message = await causeMessageOf(
      new MorphoBlueWithdrawLoanStep(
        withdrawQuote({ withdrawAssets: 1n, withdrawShares: 1n }),
      ).getValidStepOutput(emptyInput()),
    );
    expect(message).to.match(/exactly one of/);
  });

  it('Should reject a quote with neither denomination set', async () => {
    // A quote is a plain object a caller can hand-construct, and Blue's revert
    // for this is swallowed under requireSuccess = false.
    const message = await causeMessageOf(
      new MorphoBlueWithdrawLoanStep(
        withdrawQuote({ withdrawAssets: 0n, withdrawShares: 0n }),
      ).getValidStepOutput(emptyInput()),
    );
    expect(message).to.match(/exactly one of/);
  });

  it('Should output the withdrawn asset deterministically', async () => {
    const output = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote(),
    ).getValidStepOutput(emptyInput());

    const withdrawn = output.outputERC20Amounts[0];
    expect(withdrawn.tokenAddress).to.equal(LOAN);
    expect(withdrawn.expectedBalance).to.equal(1_000_000n);
    expect(withdrawn.minBalance).to.equal(1_000_000n);
  });

  it('Should record the supply leg shrinking', async () => {
    const output = await new MorphoBlueWithdrawLoanStep(
      withdrawQuote(),
    ).getValidStepOutput(emptyInput());

    const positions = onlyAddressBound(output.outputPositions);
    expect(positions[0].kind).to.equal('supply');
    expect(positions[0].direction).to.equal('decrease');
    expect(positions[0].owner).to.equal(OWNER);
  });
});

describe('lend-side failure modes', () => {
  it('Should name free liquidity, not health, as what refuses a withdrawal', () => {
    const mode = getStepFailureMode('MorphoBlueWithdrawLoanStep');
    expect(mode?.onOwnFailure.detail).to.match(/liquidity/i);
    // The distinction is the point: collateral is never lent out, so
    // withdrawing it only faces a health check. A lender can be perfectly
    // healthy and still locked out by utilization.
    expect(mode?.onOwnFailure.residue).to.equal('protocol');
  });

  it('Should classify a surviving supply claim as public-recoverable', () => {
    const mode = getStepFailureMode('MorphoBlueSupplyLoanStep');
    expect(mode?.onLaterFailure.residue).to.equal('protocol');
    expect(mode?.onLaterFailure.recovery).to.equal('public-recoverable');
  });
});
