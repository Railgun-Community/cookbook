import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeInput } from '../../../models/export-models';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
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
const nftAddress = '0x1234567890';
const tokenSubID = '0x0000';

describe.skip('FORK-run-empty-recipe', function run() {
  this.timeout(45000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should run empty-recipe with ERC721 inputs', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new EmptyRecipe();

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [],
      nfts: [
        {
          nftAddress,
          tokenSubID,
          amount: 1n,
          nftTokenType: NFTTokenType.ERC721,
        },
      ],
    };

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    // RUN AGAIN TO MAKE SURE THE NFT WAS SHIELDED PROPERLY:
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
