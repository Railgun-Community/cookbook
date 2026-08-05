import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  getRelayAdaptTransactionError,
  pauseAllPollingProviders,
} from '@railgun-community/wallet';
import {
  NFTTokenType,
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
  MIN_GAS_LIMIT_EMPTY,
  MIN_GAS_LIMIT_FXMINT_ADJUST,
  MIN_GAS_LIMIT_FXMINT_CLOSE,
  MIN_GAS_LIMIT_FXMINT_OPEN,
} from '../min-gas-limits';
import {
  computeFxClose,
  resolvePool,
  type FxMintPoolName,
  type ResolvedFxPool,
} from '../../steps/borrow/fx/fx-mint-util';
import {
  getFxPool,
  getFxPosition,
  getNextFxPositionId,
} from '../../api/borrow/fx/fx-position-reader';
import { getTestEthersWallet, getTestProvider } from '../../test/shared.test';
import { waitForShieldedNFTBalance } from '../../test/railgun-setup.test';
import { FxMintOpenRecipe } from '../../recipes/borrow/fx/fx-mint-open-recipe';
import { FxMintTopupAndBorrowRecipe } from '../../recipes/borrow/fx/fx-mint-topup-and-borrow-recipe';
import { FxMintCloseRecipe } from '../../recipes/borrow/fx/fx-mint-close-recipe';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;

/**
 * Measures `MIN_GAS_LIMIT_FXMINT_ADJUST` and `MIN_GAS_LIMIT_FXMINT_CLOSE`.
 *
 * Sibling of `FORK-measure-7702-gas-floors`, which measures the two legs that
 * need no pre-existing position (`EmptyRecipe`, `FxMintOpenRecipe`). Adjust and
 * close cannot go in that file because they need a **position that already
 * exists and is already shielded**, and `measure7702BatchGasFloor` snapshots and
 * reverts around every probe — so the position has to be built before any
 * bisection starts, in a `before` hook, or the first probe destroys it.
 *
 * ## What is being measured, and why it is not the obvious thing
 *
 * A `MIN_GAS_LIMIT_*` constant is **not** a gas cost. It becomes
 * `actionData.minGasLimit`, which RelayAdapt enforces as `gasleft() >= K`
 * *after* intrinsic and calldata gas has already been spent. So:
 *
 *   K = cost_floor - pre_check_overhead
 *
 * Both terms are measured here, per leg:
 *
 *  - **cost floor** — bisected with `actionDataMinGasLimit: 0n`, which makes the
 *    in-contract require vacuous so the search finds where the *work* fits.
 *    Measuring with the declared constant instead finds where the *require*
 *    passes, which is a function of the constant being calibrated (F10).
 *  - **pre-check overhead** — re-bisected with `actionDataMinGasLimit` forced to
 *    a value ABOVE the leg's cost floor, so the require is what binds; the
 *    overhead is then `floor - forcedK`. It is measured per leg rather than
 *    reused from EMPTY/OPEN because it scales with calldata, and these legs
 *    carry an NFT unshield that EMPTY and OPEN do not.
 *
 * The forced value must clear the cost floor or the result is not an overhead at
 * all: EMPTY's control used 2_500_000, which is *below* both of these legs'
 * floors and would have silently re-measured the cost. `reportOverhead` asserts
 * `overhead > 0`, which is precisely that check.
 *
 * Each `it` performs exactly **one** bisection, and cost and overhead are
 * separate tests, so a leg can be run on its own with `--grep`.
 *
 * Run:
 *   env RUN_FORK_TESTS=1 NODE_ENV=test DEBUG='railgun:setup' \
 *     ETHEREUM_RPC=<archive> npx mocha \
 *     --grep "FORK-measure-7702-fx-position-gas-floors" --timeout 1500000
 */

// Same pool and the same opening size as the fx OPEN measurement in
// FORK-measure-7702-gas-floors, so the three fx figures are comparable.
const POOL: FxMintPoolName = 'wstETH-Long';
const OPEN_COLLATERAL = 20_000_000_000_000_000n; // 0.02 wstETH
const OPEN_DEBT = 5_000_000_000_000_000_000n; // 5 fxUSD

// Adjust leg: top up 0.01 wstETH AND borrow 1 more fxUSD. Of the four recipes
// that share MIN_GAS_LIMIT_FXMINT_ADJUST (topup, topup+borrow, borrow-more,
// repay-debt) this is the dearest — it is the only one that moves BOTH axes of
// operate() and shields an ERC20 *and* the position NFT back. One constant has
// to clear the whole family, so it is sized on the dearest member.
const ADJUST_COLLATERAL_UNSHIELD = 10_000_000_000_000_000n; // 0.01 wstETH
const ADJUST_ADDITIONAL_DEBT = 1_000_000_000_000_000_000n; // 1 fxUSD

// Close leg, partial: repay ~2 of the 5 fxUSD.
//
// NOTE the original rationale here was wrong and the correction matters for
// reading the numbers: it said a partial close is dearer because a full close
// "burns the NFT inside operate() and has no NFT shield leg". f(x) does NOT burn
// on close — measured, 0 burns in 200k blocks — and the step now declares the
// NFT unconditionally, so BOTH branches shield it back and carry that leg. Any
// remaining gap between the two is the repay size, not the NFT.
const CLOSE_PARTIAL_DEBT_UNSHIELD = 2_000_000_000_000_000_000n; // 2 fxUSD

// Close leg, full: enough fxUSD to repay the entire debt after the 25bp unshield
// haircut and the f(x) repay fee.
const CLOSE_FULL_DEBT_UNSHIELD = 6_000_000_000_000_000_000n; // 6 fxUSD

// Bisection window. Deliberately wide on the top: the upper-bound guard in
// measure7702BatchGasFloor only proves "not a gas problem" if the ceiling is far
// above any plausible floor.
const BISECT_LO = 1_000_000n;
// 12_000_000 was ~4x wider than any plausible answer (fx OPEN's measured cost is
// 2_766_112) and it made the search pathologically slow: a FAILING probe runs the
// batch until it genuinely runs out, so a 12M ceiling burns up to 12M gas of real
// EVM execution per failed probe. Observed ~9 minutes per probe against a fork
// carrying this much state. 5M stays comfortably above every fx leg while cutting
// the cost of each failure ~2.4x.
const BISECT_HI = 3_500_000n;

// Tighter than the harness default of 25_000, but not as tight as 2_000, which
// was false precision: the same batch measures 29_053 gas apart across merkle
// tree states (F11 — EMPTY moved by exactly that between two fork regimes, as did
// fx OPEN cold-vs-warm). Resolving to 2k inside a quantity that moves by 29k
// costs ~4 extra probes to report noise. 10k is well inside the state spread and
// still 2.5x tighter than the default.
// 50k. These are BASELINES, not precision instruments — the same batch measures
// 29_053 gas apart across merkle tree states (F11), so anything finer reports
// noise at real cost: a failing probe runs the batch until it genuinely runs out
// of gas, and close probes were observed at ~12 minutes each. Halving the probe
// count matters more than the last 40k.
const BISECT_TOLERANCE = 50_000n;

/**
 * `actionData.minGasLimit` for the overhead measurements — a value chosen to sit
 * comfortably ABOVE the leg's cost floor so the in-contract `gasleft() >= K`
 * require, not the work, is what the bisection finds.
 *
 * It must be above the cost floor or the number means nothing: EMPTY's control
 * used 2_500_000, which is BELOW both of these legs' floors and would have
 * re-measured the cost. The overhead tests assert `overhead > 0`, which is
 * exactly the check that this value did bind.
 */
const ADJUST_REQUIRE_K = 4_000_000n;
const CLOSE_REQUIRE_K = 4_000_000n;

/** Window for the overhead bisection: [K, K + this]. Overhead is ~100k. */
const REQUIRE_WINDOW = 600_000n;

type FxPositionFixture = {
  pool: ResolvedFxPool;
  positionId: bigint;
  tokenSubID: string;
};

let fixture: Optional<FxPositionFixture>;

const requireFixture = (): FxPositionFixture => {
  if (!fixture) {
    throw new Error(
      'fx position fixture was not built — the before hook did not run',
    );
  }
  return fixture;
};

/**
 * Build the thing adjust and close need and open does not: a position that
 * exists on chain and whose NFT is already shielded to the test RAILGUN wallet.
 *
 * Built by executing a real `FxMintOpenRecipe` batch on the 7702 path, and
 * **not** by opening straight from the test EOA. The direct route looks cheaper
 * — two transactions, no proof — but it does not work here: `setupForkTests`
 * shields the signer's entire balance of every test token, so the EOA holds zero
 * wstETH by the time any test runs, and `operate()` reverts with
 * `ERC20: transfer amount exceeds balance`. The collateral only exists inside
 * the RAILGUN wallet, so unshielding it through a batch is the only way to reach
 * it. The batch also shields the minted NFT back in the same transaction, which
 * is what the close/adjust proofs need to unshield later.
 *
 * The wire gas limit is set explicitly and generously rather than taken from
 * `eth_estimateGas`: `requireSuccess` is hardcoded false on the 7702 path, so
 * the estimate converges on outer-call success and can return a value at which
 * the shield epilogue silently fails. The measured open floor is ~2.77M, so 8M
 * is far clear of it.
 */
const createShieldedFxPosition = async (): Promise<FxPositionFixture> => {
  const provider = getTestProvider();
  const signer = getTestEthersWallet();
  const pool = resolvePool(POOL);

  // Read the id BEFORE opening: the pool assigns it, and getNextPositionId is
  // the only way to know which one this open will take. No race on a fork —
  // nothing else is transacting.
  const positionId = await getNextFxPositionId(POOL, provider);
  const fxPool = await getFxPool(POOL, provider);

  const recipe = new FxMintOpenRecipe({
    pool: POOL,
    targetDebt: OPEN_DEBT,
    predictedPositionId: positionId,
    borrowFeeRatio: fxPool.borrowFeeRatio,
  });
  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
        isBaseToken: false,
        amount: OPEN_COLLATERAL,
      },
    ],
    nfts: [],
  };
  const recipeOutput = await recipe.getRecipeOutput(recipeInput);

  const { transaction } = await createCrossContractCalls7702ForTest(
    txidVersion,
    networkName,
    recipeInput,
    recipeOutput,
  );
  const receipt = await (
    await signer.sendTransaction({ ...transaction, gasLimit: 8_000_000n })
  ).wait();
  if (receipt == null || receipt.status !== 1) {
    throw new Error('fx fixture: the 7702 open batch did not mine');
  }
  const relayAdaptError = getRelayAdaptTransactionError(
    txidVersion,
    receipt.logs.map(log => ({
      topics: log.topics as string[],
      data: log.data,
    })),
  );
  if (isDefined(relayAdaptError)) {
    throw new Error(
      `fx fixture: open batch subcall revert: ${relayAdaptError}`,
    );
  }

  const tokenSubID = `0x${positionId.toString(16)}`;

  // Proves three things at once: operate() minted the predicted id, the shield
  // epilogue ran, and the engine has scanned the note — without which no
  // close/adjust proof can spend it.
  await waitForShieldedNFTBalance(
    txidVersion,
    networkName,
    pool.address,
    tokenSubID,
  );

  // eslint-disable-next-line no-console
  console.log(
    `  fx fixture: opened ${POOL} position ${positionId} ` +
      `(${OPEN_COLLATERAL} collateral / ${OPEN_DEBT} debt), gasUsed ${receipt.gasUsed}, NFT shielded`,
  );

  return { pool, positionId, tokenSubID };
};

/**
 * One bisection, then re-pause the engine's chain polling.
 *
 * `measure7702BatchGasFloor` pauses the pollers for its probe loop and calls
 * `resumeIsolatedPollingProviderForNetwork` on the way out. That resume is wrong
 * for a file that measures more than once: in the gap the engine scans blocks
 * that `evm_revert` has already undone and kicks off a TXID sync, and the next
 * measurement in the same process then stops making progress — every probe after
 * the first simply never returns, with the process and the node both idle.
 *
 * Re-pausing here closes the gap. Nothing in this file needs the engine to watch
 * the chain after the fixture is built.
 */
const measureFloor = async (
  name: string,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
  opts: {
    lo: bigint;
    hi: bigint;
    actionDataMinGasLimit?: bigint;
  },
) => {
  try {
    return await measure7702BatchGasFloor(name, recipeInput, recipeOutput, {
      ...opts,
      toleranceGas: BISECT_TOLERANCE,
    });
  } finally {
    pauseAllPollingProviders();
  }
};

/** Report a cost-floor bisection and check it actually bracketed an answer. */
const reportCostFloor = (
  name: string,
  measurement: GasFloorMeasurement,
  declaredConstant: bigint,
) => {
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '='.repeat(70),
      `7702 COST FLOOR — ${name}`,
      `  fork block            : ${measurement.forkBlockNumber}`,
      `  cost floor            : ${measurement.minSuccessfulGasLimit}`,
      `  max failing probe     : ${String(measurement.maxFailingGasLimit)}`,
      `  declared today        : ${declaredConstant}`,
      `  probes                : ${measurement.probes.length}`,
      '='.repeat(70),
      '',
    ].join('\n'),
  );

  // The number only means something if the search bracketed it. Without a
  // failing probe below the successful one, the "floor" could just be the
  // ceiling the search started at — a clean result from a test that cannot fail.
  expect(measurement.maxFailingGasLimit).to.not.equal(
    undefined,
    `${name}: no failing probe — the search never bracketed a floor, so the number proves nothing`,
  );
};

/** Report a forced-require bisection as the leg's pre-check overhead. */
const reportOverhead = (
  name: string,
  measurement: GasFloorMeasurement,
  forcedK: bigint,
) => {
  const overhead = measurement.minSuccessfulGasLimit - forcedK;

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '='.repeat(70),
      `7702 PRE-CHECK OVERHEAD — ${name}`,
      `  fork block            : ${measurement.forkBlockNumber}`,
      `  forced require K      : ${forcedK}`,
      `  floor with it         : ${measurement.minSuccessfulGasLimit}`,
      `  overhead              : ${overhead}`,
      `  probes                : ${measurement.probes.length}`,
      `  => K = cost_floor - ${overhead}, rounded UP`,
      '='.repeat(70),
      '',
    ].join('\n'),
  );

  expect(measurement.maxFailingGasLimit).to.not.equal(
    undefined,
    `${name}: the forced-require search never bracketed a threshold`,
  );
  // A non-positive overhead means the forced K sat BELOW the cost floor, so the
  // bisection re-found the cost and this number is not an overhead at all.
  expect(overhead > 0n).to.equal(
    true,
    `${name}: forced require ${forcedK} did not bind (floor ${measurement.minSuccessfulGasLimit}) — raise it above the leg's cost floor`,
  );
};

type MeasurementSubject = {
  name: string;
  recipeInput: RecipeInput;
  recipeOutput: RecipeOutput;
};

/**
 * The dearest member of the adjust family: both axes of operate() move, and an
 * ERC20 *and* the position NFT shield back.
 */
const buildAdjust = async (): Promise<MeasurementSubject> => {
  const { pool, positionId, tokenSubID } = requireFixture();
  const fxPool = await getFxPool(POOL, getTestProvider());

  const recipe = new FxMintTopupAndBorrowRecipe({
    pool: POOL,
    positionId,
    additionalDebt: ADJUST_ADDITIONAL_DEBT,
    borrowFeeRatio: fxPool.borrowFeeRatio,
  });

  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: pool.collateralToken,
        decimals: pool.collateralDecimals,
        isBaseToken: false,
        amount: ADJUST_COLLATERAL_UNSHIELD,
      },
    ],
    nfts: [
      {
        nftAddress: pool.address,
        tokenSubID,
        nftTokenType: NFTTokenType.ERC721,
        amount: 1n,
      },
    ],
  };

  return {
    name: recipe.config.name,
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

/**
 * A close sized by `computeFxClose` against the live position and the live fee
 * table — neither is assumed. `expectPartial` states which side of the debt
 * ceiling the unshield amount is supposed to land on, and is asserted rather
 * than trusted: a partial close that silently became a full one would measure a
 * different batch (no NFT shield leg) under the same name.
 */
const buildClose = async (
  debtTokenUnshield: bigint,
  expectPartial: boolean,
): Promise<MeasurementSubject> => {
  const { pool, positionId, tokenSubID } = requireFixture();
  const provider = getTestProvider();
  const fxPool = await getFxPool(POOL, provider);
  const position = await getFxPosition(positionId, POOL, provider);

  const closeAmounts = computeFxClose({
    collateral: position.collateralAmount,
    debt: position.debt,
    availableDebtToken: debtTokenUnshield,
    repayFeeRatio: fxPool.repayFeeRatio,
    withdrawFeeRatio: fxPool.withdrawFeeRatio,
    railgunUnshieldFeeBps: MOCK_UNSHIELD_FEE_BASIS_POINTS,
  });
  expect(closeAmounts.partialClose).to.equal(
    expectPartial,
    `expected a ${
      expectPartial ? 'PARTIAL' : 'FULL'
    } close for an unshield of ${debtTokenUnshield} against debt ${
      position.debt
    }`,
  );

  const recipe = new FxMintCloseRecipe({
    pool: POOL,
    positionId,
    repayAmount: closeAmounts.repayAmount,
    withdrawColl: closeAmounts.withdrawColl,
    approveAmount: closeAmounts.approveAmount,
    withdrawFeeRatio: closeAmounts.withdrawFeeRatio,
    partialClose: closeAmounts.partialClose,
  });

  const recipeInput: RecipeInput = {
    railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    networkName,
    erc20Amounts: [
      {
        tokenAddress: pool.debtToken,
        decimals: pool.debtDecimals,
        isBaseToken: false,
        amount: debtTokenUnshield,
      },
    ],
    nfts: [
      {
        nftAddress: pool.address,
        tokenSubID,
        nftTokenType: NFTTokenType.ERC721,
        amount: 1n,
      },
    ],
  };

  return {
    name: `${recipe.config.name} (${expectPartial ? 'partial' : 'full'})`,
    recipeInput,
    recipeOutput: await recipe.getRecipeOutput(recipeInput),
  };
};

describe('FORK-measure-7702-fx-position-gas-floors', function run() {
  this.timeout(1_500_000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
    if (shouldSkip7702ForkTest(networkName)) {
      return;
    }
    fixture = await createShieldedFxPosition();
  });

  it('[FORK] fx adjust (topup + borrow) — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildAdjust();
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
    });
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_FXMINT_ADJUST);

    // An adjust strictly contains the empty case (unshield + shield) plus an
    // approve, an operate() and an NFT round trip, so it cannot be cheaper.
    expect(measurement.minSuccessfulGasLimit > MIN_GAS_LIMIT_EMPTY).to.equal(
      true,
      `fx adjust floor ${measurement.minSuccessfulGasLimit} is below the empty-recipe floor`,
    );
  });

  it('[FORK] fx adjust (topup + borrow) — pre-check overhead', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildAdjust();
    const measurement = await measureFloor(
      `${name} [require]`,
      recipeInput,
      recipeOutput,
      {
        lo: ADJUST_REQUIRE_K,
        hi: ADJUST_REQUIRE_K + REQUIRE_WINDOW,
        actionDataMinGasLimit: ADJUST_REQUIRE_K,
      },
    );
    reportOverhead(name, measurement, ADJUST_REQUIRE_K);
  });

  it('[FORK] fx PARTIAL close — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildClose(
      CLOSE_PARTIAL_DEBT_UNSHIELD,
      true,
    );
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
    });
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_FXMINT_CLOSE);

    expect(measurement.minSuccessfulGasLimit > MIN_GAS_LIMIT_EMPTY).to.equal(
      true,
      `fx close floor ${measurement.minSuccessfulGasLimit} is below the empty-recipe floor`,
    );
  });

  it('[FORK] fx PARTIAL close — pre-check overhead', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildClose(
      CLOSE_PARTIAL_DEBT_UNSHIELD,
      true,
    );
    const measurement = await measureFloor(
      `${name} [require]`,
      recipeInput,
      recipeOutput,
      {
        lo: CLOSE_REQUIRE_K,
        hi: CLOSE_REQUIRE_K + REQUIRE_WINDOW,
        actionDataMinGasLimit: CLOSE_REQUIRE_K,
      },
    );
    reportOverhead(name, measurement, CLOSE_REQUIRE_K);
  });

  it('[FORK] fx FULL close — cost floor', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    const { recipeInput, recipeOutput, name } = await buildClose(
      CLOSE_FULL_DEBT_UNSHIELD,
      false,
    );
    const measurement = await measureFloor(name, recipeInput, recipeOutput, {
      lo: BISECT_LO,
      hi: BISECT_HI,
    });
    reportCostFloor(name, measurement, MIN_GAS_LIMIT_FXMINT_CLOSE);

    // The constant is sized on the PARTIAL close. Both branches now shield the
    // NFT back (f(x) does not burn on close), so this figure exists to show
    // where a full close actually lands rather than to assert it is cheaper.
    expect(
      measurement.minSuccessfulGasLimit > MIN_GAS_LIMIT_FXMINT_OPEN,
    ).to.equal(
      true,
      `fx full-close floor ${measurement.minSuccessfulGasLimit} is below the fx open floor`,
    );
  });
});
