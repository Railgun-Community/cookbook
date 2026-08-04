import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { EmptyRecipe } from '../empty-recipe';
import {
  executeRecipe7702AndAssertUnshieldBalances,
  getTestEphemeralAddress,
  shouldSkip7702ForkTest,
} from '../../../test/common-7702.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

/**
 * Harness-validation test for the EIP-7702 execute path.
 *
 * Deliberately uses `EmptyRecipe` — the recipe with no steps of its own — so
 * that a failure here is unambiguously the *harness*, not a recipe. Every real
 * 7702 subject (the fx and Morpho combos) also needs a 0x quote and exotic
 * shielded collateral; debugging the type-4 path through one of those would
 * conflate three unknowns.
 *
 * This is the counterpart of FORK-run-empty-recipe.test.ts, which drives the
 * same recipe through relay-adapt.
 */
describe('FORK-run-empty-recipe-7702', function run() {
  this.timeout(120000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should execute a recipe through the 7702 execute path', async function run() {
    if (shouldSkip7702ForkTest(networkName)) {
      this.skip();
      return;
    }

    const ephemeralAddress = await getTestEphemeralAddress(networkName);
    expect(ephemeralAddress).to.be.a('string');
    expect(ephemeralAddress.length).to.equal(42);

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

    const {
      gasUsed,
      ephemeralAddress: executedWith,
      residueReport,
    } = await executeRecipe7702AndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
      {
        // EmptyRecipe's min gas limit is tuned for the relay-adapt path; the
        // 7702 path has a different constant cost. Measuring is the point of
        // this test, so don't gate on the untuned window.
        skipGasWindowAssertion: true,
        // No policy: EmptyRecipe approves nothing and holds nothing, so the
        // executor must end completely clean.
      },
    );

    expect(executedWith).to.equal(ephemeralAddress);

    // Prove the residue assertion actually looked at something. A bug in
    // surface collection would otherwise make it pass vacuously here and
    // everywhere else that relies on it.
    expect(
      residueReport.surface.tokenAddresses.map(a => a.toLowerCase()),
    ).to.include(tokenAddress.toLowerCase());
    expect(residueReport.surface.allowances).to.deep.equal(
      [],
      'EmptyRecipe encodes no approvals',
    );

    // eslint-disable-next-line no-console
    console.log(
      `[7702] ${recipe.config.name} gasUsed=${gasUsed} (minGasLimit=${recipeOutput.minGasLimit})`,
    );
  });
});
