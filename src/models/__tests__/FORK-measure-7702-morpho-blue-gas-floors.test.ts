import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  getRelayAdaptTransactionError,
  pauseAllPollingProviders,
} from '@railgun-community/wallet';
import {
  NetworkName,
  TXIDVersion,
  isDefined,
} from '@railgun-community/shared-models';
import { RecipeInput, RecipeOutput } from '../export-models';
import { setRailgunFees } from '../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../test/mocks.test';
import {
  createCrossContractCalls7702ForTest,
  measure7702BatchGasFloor,
  shouldSkip7702ForkTest,
  type GasFloorMeasurement,
} from '../../test/common-7702.test';
import {
  MIN_GAS_LIMIT_MORPHO_BLUE_BORROW,
  MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
  MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW,
  MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW,
} from '../min-gas-limits';
import {
  getTestEthersWallet,
  getTestProvider,
  getTestRailgunWallet,
} from '../../test/shared.test';
import { getCurrentEphemeralAddress } from '@railgun-community/wallet';
import { testConfig } from '../../test/test-config.test';
import { MorphoBlueAPI } from '../../api/morpho';
import type { MarketParams } from '../../steps/morpho/morpho-blue-util';
import { MorphoBlueSupplyCollateralAndBorrowRecipe } from '../../recipes/morpho/blue-supply-collateral-and-borrow-recipe';
import { MorphoBlueRepayRecipe } from '../../recipes/morpho/blue-repay-recipe';
import { MorphoBlueRepayAndWithdrawCollateralRecipe } from '../../recipes/morpho/blue-repay-and-withdraw-collateral-recipe';
import { MorphoBlueSupplyLoanRecipe } from '../../recipes/morpho/blue-supply-loan-recipe';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;

/**
 * Measures the `MIN_GAS_LIMIT_MORPHO_BLUE_*` family, none of which had ever been
 * measured — every one is an inherited guess.
 *
 * Third in the series after `FORK-measure-7702-gas-floors` (EMPTY, fx OPEN) and
 * `FORK-measure-7702-fx-position-gas-floors` (fx ADJUST, CLOSE). The method is
 * identical and the reasoning behind it is documented in full in the fx file;
 * the short version, because getting it wrong produces a number that looks fine:
 *
 *   K = cost_floor - pre_check_overhead
 *
 * A constant is NOT a gas cost. It becomes `actionData.minGasLimit`, which
 * RelayAdapt enforces as `gasleft() >= K` AFTER intrinsic and calldata gas is
 * already spent. So the cost floor is bisected with `actionDataMinGasLimit: 0n`
 * — making the in-contract require vacuous, so the search finds where the WORK
 * fits rather than where the require passes (F10).
 *
 * ## Why Blue needs its own fixture
 *
 * Only supply-collateral-and-borrow is expressible without prior state. Repay,
 * repay-and-withdraw and the lend-side legs all need a position that already
 * exists — and `measure7702BatchGasFloor` snapshots and reverts around every
 * probe, so the position must be built in `before`, before any bisection starts.
 *
 * ## The oracle matters more here than for fx
 *
 * A Blue borrow is health-checked against an oracle price, and an
 * under-provisioned batch does not revert: `requireSuccess = false` swallows it
 * and the batch mines having drawn nothing. So the bisection cannot use "the
 * transaction mined" as its success signal — `measure7702BatchGasFloor` uses
 * shield completion, which is the only observable that distinguishes a batch
 * that worked from one that merely landed.
 *
 * Run (anvil on 8600, --hardfork prague, pinned; see
 * .claude/run-commands/cookbook-7702-fork-tests.md):
 *   env RUN_FORK_TESTS=1 NODE_ENV=test DEBUG='railgun:setup' FORK_BLOCK=<pin> \
 *     ETHEREUM_RPC=<archive> npx mocha \
 *     --grep "FORK-measure-7702-morpho-blue-gas-floors" --timeout 1500000
 */

/**
 * wstETH / USDC, 86% LLTV. Chosen because the harness already shields wstETH
 * (so the collateral leg is fundable) and USDC is the loan token, and because
 * this market carries real liquidity — a borrow against an empty market would
 * measure the revert path rather than the work.
 */
const MARKET_ID =
  '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc';

/** 0.05 wstETH of collateral, ~50 USDC drawn — a comfortable ~40% LTV. */
const SUPPLY_COLLATERAL = 50_000_000_000_000_000n;
const BORROW_ASSETS = 50_000_000n; // 6dp USDC

/**
 * MORE than the ~50 USDC the fixture borrowed, and that excess is load-bearing.
 *
 * The bisection's success oracle is a SHIELD EVENT — the only observable that
 * distinguishes a batch that worked from one that merely mined, given
 * `requireSuccess = false`. A repay sized at or below the debt consumes its
 * entire input and outputs nothing, so there is nothing to shield and the oracle
 * can never fire: the first attempt reported "MINED BUT NO SHIELD EVENT" even at
 * the 5M ceiling, which reads like a broken recipe and is not.
 *
 * `getRepayQuote` caps `repayAssets` at the owed debt and the approve step is
 * given exactly that, so the surplus falls out as change and shields back.
 */
const REPAY_UNSHIELD = 70_000_000n;
/** Collateral withdrawn on the repay+withdraw leg. */
const WITHDRAW_COLLATERAL = 10_000_000_000_000_000n;
/** Lend-side leg: supply loan asset. */
const SUPPLY_LOAN = 25_000_000n;

/**
 * An inert second token on the supply-loan leg, purely so the shield epilogue
 * has something to emit.
 *
 * Unlike repay, `MorphoBlueSupplyLoanRecipe` supplies the WHOLE loan-token input
 * with no cap, so no amount of over-supplying produces change. A token the
 * recipe does not touch passes through as an unused amount and is shielded,
 * which gives the oracle its event without altering what is being measured — the
 * pass-through costs one extra shield entry, so the figure is a slight
 * over-estimate of a bare supply. Stated rather than hidden.
 */
const SUPPLY_LOAN_PASSTHROUGH = 1_000_000_000_000_000n; // 0.001 wstETH

// Same window as the fx position file. A FAILING probe burns real EVM gas up to
// the ceiling, so a needlessly high `hi` makes every failed probe slow.
const BISECT_LO = 1_000_000n;
// NOTE: 5_000_000 is demonstrably too low for the repay legs. See the block
// comment below.
const BISECT_HI = 5_000_000n;

/**
 * ## Status: supply+borrow measured; the repay legs are NOT
 *
 * `blue supply collateral + borrow` measured cleanly (cost 2_093_750, overhead
 * 93_750, K 2_000_000) and its constant is updated. The other three legs did
 * not, and the reasons are worth writing down because two of them cost a run
 * each and neither is a code defect.
 *
 * **1. The oracle needs something to shield.** The bisection's success signal is
 * a shield EVENT, because `requireSuccess = false` makes "the transaction mined"
 * worthless. A leg that consumes its whole input and outputs nothing therefore
 * can never signal success: the first repay attempt reported "MINED BUT NO
 * SHIELD EVENT" at every gas limit including the ceiling, which reads like a
 * broken recipe and is not. Fixed by unshielding MORE than the debt (the quote
 * caps the repay at what is owed, so the surplus falls out as change) and, for
 * supply-loan, by adding an inert pass-through token. Both are in the constants
 * above.
 *
 * **2. `blue repay` then converged ON the ceiling** — floor reported as
 * 5_000_000 with the highest failing probe at 4_984_375. That is the harness
 * saying "at or above `hi`", not a measurement, and it cannot be right in the
 * obvious reading: repay is one approve plus one Blue call and supply+borrow,
 * which does strictly more, measured 2_093_750.
 *
 * Every sub-ceiling probe failed with a relay-adapt subcall revert whose decoded
 * text is mojibake (`NH{q`, which is the `Panic(uint256)` selector 0x4e487b71
 * read as UTF-8). So the reported reason may be mis-decoded returndata rather
 * than a genuine arithmetic panic, and the two possibilities imply opposite
 * fixes:
 *   - a real panic => an over-repay rounding underflow, the mirror of the
 *     one-unit borrow de-rate already measured for the ceiling in
 *     `combo-meals/morpho/util.ts`. Fix is to repay `owed - 1`.
 *   - mis-decoded OOG => `hi` is simply too low. Fix is to raise it.
 *
 * Distinguishing them needs the raw revert bytes rather than the UTF-8 attempt.
 * Do that before touching either constant — guessing has a 50% chance of moving
 * the number in the wrong direction, and a floor that is too LOW silently
 * removes the protection it exists to provide.
 *
 * `blue repay + withdraw collateral` failed the same way at the ceiling, and
 * `supply loan` never ran. MIN_GAS_LIMIT_MORPHO_BLUE_REPAY,
 * _REPAY_WITHDRAW and _BORROW therefore remain inherited guesses.
 */
const BISECT_TOLERANCE = 25_000n;

/** Forced above every plausible Blue floor, so the require binds, not the work. */
const OVERHEAD_PROBE_K = 4_500_000n;

/**
 * The supply+borrow cost floor measured by the sibling test, so the overhead
 * test can print a meaningful K. Kept as a constant rather than threaded through
 * shared state: each `it` performs exactly one bisection and must be runnable on
 * its own with `--grep`.
 */
const SUPPLY_BORROW_COST_FLOOR = 2_093_750n;

let market: MarketParams;

const measureFloor = async (
  name: string,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
  opts: { lo: bigint; hi: bigint; actionDataMinGasLimit?: bigint },
) => {
  try {
    return await measure7702BatchGasFloor(name, recipeInput, recipeOutput, {
      ...opts,
      toleranceGas: BISECT_TOLERANCE,
    });
  } finally {
    // See the fx file: the helper resumes pollers on the way out, which lets the
    // engine scan blocks `evm_revert` has undone and wedges the next
    // measurement in the same process.
    pauseAllPollingProviders();
  }
};

const reportCostFloor = (
  name: string,
  measurement: GasFloorMeasurement,
  declaredConstant: bigint,
) => {
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `  ${name}`,
      `    cost floor (wire gas)  ${measurement.minSuccessfulGasLimit}`,
      `    highest failing probe  ${measurement.maxFailingGasLimit ?? 'n/a'}`,
      `    declared constant      ${declaredConstant}`,
      '',
    ].join('\n'),
  );
  expect(measurement.minSuccessfulGasLimit > 0n).to.equal(
    true,
    `${name}: bisection did not bracket a floor`,
  );
};

const reportOverhead = (
  name: string,
  costFloor: bigint,
  requireBoundFloor: bigint,
) => {
  const overhead = requireBoundFloor - OVERHEAD_PROBE_K;
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `  ${name} — pre-check overhead`,
      `    require-bound floor    ${requireBoundFloor}`,
      `    forced K               ${OVERHEAD_PROBE_K}`,
      `    overhead               ${overhead}`,
      `    => K for cost ${costFloor} is ${costFloor - overhead}`,
      '',
    ].join('\n'),
  );
  // If the forced K did not clear the cost floor, this re-measured the cost
  // rather than the overhead — the exact mistake EMPTY's control made.
  expect(overhead > 0n).to.equal(
    true,
    `${name}: forced K ${OVERHEAD_PROBE_K} did not bind; overhead is not measurable from it`,
  );
};

/**
 * The account the batch actually executes as.
 *
 * NOT the test signer. Under 7702 the batch runs as an EPHEMERAL EOA derived
 * from the RAILGUN wallet, and that is `msg.sender` inside every call. Passing
 * the test signer here instead — which is the obvious thing to do and what the
 * first version of this file did — makes `onBehalf` the signer while
 * `msg.sender` is the ephemeral account, so Blue's `_isSenderAuthorized`
 * rejects the borrow with `unauthorized`.
 *
 * That failure is worth stating because of HOW it surfaced: the batch mined
 * with status 1 and the revert was only visible through
 * `getRelayAdaptTransactionError`. `requireSuccess = false` swallowed it — the
 * exact hazard this whole measurement exists inside.
 *
 * f(x) does not have this problem, which is why the sibling fx file needs no
 * equivalent: `operate()` credits `msg.sender` and takes no owner argument.
 */
let executorAddress: string;
const executor = () => executorAddress;

/** Build a supply-collateral-and-borrow batch. Needs no prior position. */
const buildSupplyBorrow = async () => {
  const recipe = new MorphoBlueSupplyCollateralAndBorrowRecipe(
    market,
    BORROW_ASSETS,
    executor(),
    getTestProvider(),
  );
  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: market.collateralToken,
        decimals: 18n,
        isBaseToken: false,
        amount: SUPPLY_COLLATERAL,
      },
    ],
    nfts: [],
  };
  return {
    name: 'MORPHO_BLUE_SUPPLY_BORROW',
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

/** Execute the supply+borrow batch for real, so later legs have a position. */
const createShieldedBluePosition = async (): Promise<void> => {
  const signer = getTestEthersWallet();
  const { recipeInput, recipeOutput } = await buildSupplyBorrow();

  const { transaction } = await createCrossContractCalls7702ForTest(
    txidVersion,
    networkName,
    recipeInput,
    recipeOutput,
  );
  // Well clear of any plausible floor: a tight limit here would make the FIXTURE
  // the thing being measured.
  const receipt = await (
    await signer.sendTransaction({ ...transaction, gasLimit: 8_000_000n })
  ).wait();
  if (receipt == null || receipt.status !== 1) {
    throw new Error('blue fixture: the 7702 supply+borrow batch did not mine');
  }
  const relayAdaptError = getRelayAdaptTransactionError(
    txidVersion,
    receipt.logs.map(log => ({
      topics: log.topics as string[],
      data: log.data,
    })),
  );
  if (isDefined(relayAdaptError)) {
    throw new Error(`blue fixture: subcall revert: ${relayAdaptError}`);
  }

  // Status 1 proves nothing under requireSuccess = false — read the position
  // back and require it to exist, or every measurement below is against an
  // empty position and measures the revert path.
  const position = await MorphoBlueAPI.getPosition(
    MARKET_ID,
    executor(),
    getTestProvider(),
  );
  if (position.collateral <= 0n || position.borrowShares <= 0n) {
    throw new Error(
      `blue fixture: batch mined but the position is empty ` +
        `(collateral ${position.collateral}, borrowShares ${position.borrowShares})`,
    );
  }
};

const buildRepay = async () => {
  const recipe = new MorphoBlueRepayRecipe(
    market,
    executor(),
    getTestProvider(),
  );
  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: market.loanToken,
        decimals: 6n,
        isBaseToken: false,
        amount: REPAY_UNSHIELD,
      },
    ],
    nfts: [],
  };
  return {
    name: 'MORPHO_BLUE_REPAY',
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

const buildRepayWithdraw = async () => {
  const recipe = new MorphoBlueRepayAndWithdrawCollateralRecipe(
    market,
    WITHDRAW_COLLATERAL,
    executor(),
    getTestProvider(),
  );
  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: market.loanToken,
        decimals: 6n,
        isBaseToken: false,
        amount: REPAY_UNSHIELD,
      },
    ],
    nfts: [],
  };
  return {
    name: 'MORPHO_BLUE_REPAY_WITHDRAW',
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

const buildSupplyLoan = async () => {
  const recipe = new MorphoBlueSupplyLoanRecipe(
    market,
    executor(),
    getTestProvider(),
  );
  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: market.loanToken,
        decimals: 6n,
        isBaseToken: false,
        amount: SUPPLY_LOAN,
      },
      {
        tokenAddress: market.collateralToken,
        decimals: 18n,
        isBaseToken: false,
        amount: SUPPLY_LOAN_PASSTHROUGH,
      },
    ],
    nfts: [],
  };
  return {
    name: 'MORPHO_BLUE_SUPPLY_LOAN',
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

describe('FORK-measure-7702-morpho-blue-gas-floors', function run() {
  this.timeout(1_500_000);

  before(async function before() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
    executorAddress = await getCurrentEphemeralAddress(
      getTestRailgunWallet().id,
      testConfig.encryptionKey,
      networkName,
    );
    market = await MorphoBlueAPI.getMarketParamsFromId(
      MARKET_ID,
      getTestProvider(),
    );
    await createShieldedBluePosition();
    pauseAllPollingProviders();
  });

  it('[FORK] blue supply collateral + borrow — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildSupplyBorrow();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
      actionDataMinGasLimit: 0n,
    });
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_MORPHO_BLUE_SUPPLY_BORROW);
  });

  it('[FORK] blue supply collateral + borrow — pre-check overhead', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildSupplyBorrow();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
      actionDataMinGasLimit: OVERHEAD_PROBE_K,
    });
    // The measured cost floor from the sibling test, so the printed
    // "=> K for cost X" line is meaningful rather than reporting against zero.
    reportOverhead(name, SUPPLY_BORROW_COST_FLOOR, measurement.minSuccessfulGasLimit);
  });

  it('[FORK] blue repay — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildRepay();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
      actionDataMinGasLimit: 0n,
    });
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_MORPHO_BLUE_REPAY);
  });

  it('[FORK] blue repay + withdraw collateral — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildRepayWithdraw();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
      actionDataMinGasLimit: 0n,
    });
    reportCostFloor(
      name,
      measurement,
      MIN_GAS_LIMIT_MORPHO_BLUE_REPAY_WITHDRAW,
    );

    // Repay+withdraw does strictly more than repay alone, so its floor must be
    // higher. If it is not, one of the two batches is not doing what its name
    // says — which a passing bisection alone would not reveal.
    expect(measurement.minSuccessfulGasLimit > BISECT_LO).to.equal(true);
  });

  it('[FORK] blue supply loan asset (lend side) — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildSupplyLoan();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
      actionDataMinGasLimit: 0n,
    });
    // The lend side currently borrows MIN_GAS_LIMIT_MORPHO_BLUE_REPAY on the
    // grounds that both are one approve plus one Blue call. This is the figure
    // that either supports that or does not.
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_MORPHO_BLUE_REPAY);
  });
});
