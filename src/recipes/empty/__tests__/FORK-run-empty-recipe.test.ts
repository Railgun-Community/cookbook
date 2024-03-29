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
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';

chai.use(chaiAsPromised);

const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('FORK-run-empty-recipe with ERC20 inputs', function run() {
  this.timeout(45000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should run empty-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
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
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // N/A

    // 2. Add External Balance expectations.
    // N/A
  });
});
