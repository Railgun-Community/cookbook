import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeInput } from '../export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../test/mocks.test';
import { EmptyRecipe } from '../../recipes/empty/empty-recipe';
import {
  measure7702BatchGasFloor,
  shouldSkip7702ForkTest,
} from '../../test/common-7702.test';
import { MIN_GAS_LIMIT_EMPTY } from '../min-gas-limits';
import { FxMintOpenRecipe } from '../../recipes/borrow/fx/fx-mint-open-recipe';
import { resolvePool } from '../../steps/borrow/fx/fx-mint-util';
import {
  getFxPool,
  getNextFxPositionId,
} from '../../api/borrow/fx/fx-position-reader';
import { getTestProvider } from '../../test/shared.test';
import { ZeroXSwap_FxMintOpen_ComboMeal } from '../../combo-meals/fx/zero-x-swap-fx-mint-open-combo-meal';
import { getTestEphemeralAddress } from '../../test/common-7702.test';
import { testConfig } from '../../test/test-config.test';
import { ZeroXConfig } from '../zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

/**
 * Produces the `MIN_GAS_LIMIT_*` numbers, rather than asserting guesses.
 *
 * Every measured value currently in `min-gas-limits.ts` was taken on the
 * **relay-adapt** path. Nothing in that file has ever been measured on the 7702
 * path, which is the path this branch actually ships.
 *
 * The subject is `EmptyRecipe` on purpose: it is the one recipe with no steps of
 * its own, so its floor is the constant cost of the 7702 path — unshield, the
 * adapt call, and the shield epilogue — and every other recipe strictly contains
 * it. Measuring it first gives the whole table a calibrated base, and gives this
 * test a published number to be compared against
 * (`MIN_GAS_LIMIT_EMPTY = 1.783M`, relay-adapt).
 *
 * Run:
 *   env RUN_FORK_TESTS=1 NODE_ENV=test FORK_BLOCK=<block> \
 *     ETHEREUM_RPC=<archive> npx mocha --grep "FORK-measure-7702-gas-floors"
 *
 * `FORK_BLOCK` is not optional for a measurement: `anvil_reset` re-forks at head
 * unless the block is restated, and figures taken at drifting blocks are not
 * comparable run to run.
 */
describe('FORK-measure-7702-gas-floors', function run() {
  this.timeout(1_500_000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] measures the 7702 floor for the empty recipe', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new EmptyRecipe();
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

    const measurement = await measure7702BatchGasFloor(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const { minSuccessfulGasLimit, maxFailingGasLimit, forkBlockNumber } =
      measurement;

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '='.repeat(66),
        `7702 GAS FLOOR — ${recipe.config.name}`,
        `  fork block          : ${forkBlockNumber}`,
        `  min gas limit that`,
        `    COMPLETED the shield: ${minSuccessfulGasLimit}`,
        `  max gas limit that`,
        `    FAILED it           : ${String(maxFailingGasLimit)}`,
        `  declared minGasLimit  : ${recipeOutput.minGasLimit}`,
        `  MIN_GAS_LIMIT_EMPTY   : ${MIN_GAS_LIMIT_EMPTY} (relay-adapt path)`,
        `  probes                : ${measurement.probes.length}`,
        '='.repeat(66),
        '',
      ].join('\n'),
    );

    // The measurement is only meaningful if the search actually bracketed the
    // answer. Without a failing probe below the successful one, the "floor"
    // could just be the upper bound the search started at — a clean bill of
    // health from a test that cannot fail.
    expect(maxFailingGasLimit).to.not.equal(
      undefined,
      'no failing probe: the search never bracketed a floor, so the number proves nothing',
    );
    if (maxFailingGasLimit !== undefined) {
      expect(maxFailingGasLimit < minSuccessfulGasLimit).to.equal(
        true,
        `bracket inverted: failing ${maxFailingGasLimit} >= succeeding ${minSuccessfulGasLimit}`,
      );
    }

    // Sanity, not a floor assertion: a batch that unshields, calls, and shields
    // cannot plausibly cost under 100k.
    expect(minSuccessfulGasLimit > 100_000n).to.equal(true);
  });

  it('[FORK] measures the 7702 floor for an fx open on wstETH-Long', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const pool = resolvePool('wstETH-Long');

    // Read the pool rather than assume it — the house convention (README:120,
    // "read it, don't assume") and the reason adding short pools touched no step
    // logic. The borrow fee and the next position id both move.
    const fxPool = await getFxPool('wstETH-Long', provider);
    const predictedPositionId = await getNextFxPositionId(
      'wstETH-Long',
      provider,
    );

    const recipe = new FxMintOpenRecipe({
      pool: 'wstETH-Long',
      targetDebt: 5_000_000_000_000_000_000n, // 5 fxUSD
      predictedPositionId,
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
          amount: 20_000_000_000_000_000n, // 0.02 wstETH
        },
      ],
      nfts: [],
    };

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

    const measurement = await measure7702BatchGasFloor(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const { minSuccessfulGasLimit, maxFailingGasLimit, forkBlockNumber } =
      measurement;

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '='.repeat(66),
        `7702 GAS FLOOR — ${recipe.config.name} (wstETH-Long)`,
        `  fork block          : ${forkBlockNumber}`,
        `  position id         : ${predictedPositionId}`,
        `  borrowFeeRatio      : ${fxPool.borrowFeeRatio}`,
        `  min gas limit that`,
        `    COMPLETED the shield: ${minSuccessfulGasLimit}`,
        `  max gas limit that`,
        `    FAILED it           : ${String(maxFailingGasLimit)}`,
        `  declared minGasLimit  : ${recipeOutput.minGasLimit}`,
        `  probes                : ${measurement.probes.length}`,
        '='.repeat(66),
        '',
      ].join('\n'),
    );

    expect(maxFailingGasLimit).to.not.equal(
      undefined,
      'no failing probe: the search never bracketed a floor',
    );

    // An fx open strictly contains the empty case (unshield + shield) plus an
    // approve plus an operate() that mints an ERC-721, so it cannot be cheaper.
    expect(minSuccessfulGasLimit > MIN_GAS_LIMIT_EMPTY).to.equal(
      true,
      `fx open floor ${minSuccessfulGasLimit} is below the empty-recipe floor`,
    );
  });

  it('[FORK] measures the 7702 floor for the fx open COMBO (the §4.1 flow)', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }
    if (testConfig.zeroXApiKey === '' && testConfig.zeroXProxyApiDomain === '') {
      // A combo self-quotes against live 0x. Without credentials the quote throws
      // MissingHeadersError and the "measurement" would just be that.
      // eslint-disable-next-line no-console
      console.log('Skipping combo floor: set ZERO_X_API_KEY.');
      this.skip();
      return;
    }
    // `ZeroXConfig` is a static mutable read at fetch time (updates.md §4.8), so
    // it must be set before the combo self-quotes. Nothing wires testConfig into
    // it automatically — the quote tests do it by hand too.
    ZeroXConfig.API_KEY = testConfig.zeroXApiKey;
    ZeroXConfig.PROXY_API_DOMAIN = testConfig.zeroXProxyApiDomain;

    const provider = getTestProvider();
    const fxPool = await getFxPool('wstETH-Long', provider);
    const predictedPositionId = await getNextFxPositionId(
      'wstETH-Long',
      provider,
    );
    const recipient = await getTestEphemeralAddress(networkName);

    // Enter from WETH — exactly the §4.1 mainnet flow, which unshielded WETH,
    // swapped to wstETH and opened the position. That batch carried 3,016,590
    // and still ran out of gas at the shield.
    const comboMeal = new ZeroXSwap_FxMintOpen_ComboMeal({
      pool: 'wstETH-Long',
      targetDebt: 5_000_000_000_000_000_000n,
      predictedPositionId,
      borrowFeeRatio: fxPool.borrowFeeRatio,
      sellERC20Info: { tokenAddress, decimals: 18n },
      swapSlippageBasisPoints: 100,
      recipient,
    });

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 50_000_000_000_000_000n, // 0.05 WETH in
        },
      ],
      nfts: [],
    };

    const recipeOutput = await comboMeal.getComboMealOutput(recipeInput);

    const measurement = await measure7702BatchGasFloor(
      comboMeal.config.name,
      recipeInput,
      recipeOutput,
    );

    const { minSuccessfulGasLimit, maxFailingGasLimit, forkBlockNumber } =
      measurement;

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '='.repeat(66),
        `7702 GAS FLOOR — ${comboMeal.config.name}`,
        `  fork block          : ${forkBlockNumber}`,
        `  min gas limit that`,
        `    COMPLETED the shield: ${minSuccessfulGasLimit}`,
        `  max gas limit that`,
        `    FAILED it           : ${String(maxFailingGasLimit)}`,
        `  declared minGasLimit  : ${recipeOutput.minGasLimit}`,
        `  §4.1 mainnet batch    : 3016590 (RAN OUT at the shield)`,
        '='.repeat(66),
        '',
      ].join('\n'),
    );

    expect(maxFailingGasLimit).to.not.equal(undefined);
  });
});
