import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeInput,
} from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import { testRPCProvider } from '../../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../../test/common.test';
import { NetworkName } from '@railgun-community/shared-models';
import { GMXMintStakeGLPRecipe } from '../gmx-stake-mint-glp-recipe';
import { testConfig } from '../../../../test/test-config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Arbitrum;

const oneInDecimals18 = 10n ** 18n;
const slippagePercentage = 0.01;

const DAI_TOKEN: RecipeERC20Info = {
  tokenAddress: testConfig.contractsArbitrum.dai,
  decimals: 18n,
};

describe.skip('FORK-gmx-stake-mint-glp-recipe', function run() {
  this.timeout(120000);

  before(async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should run gmx-stake-mint-glp-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }
    if (!testRPCProvider) {
      throw new Error('Requires test rpc provider');
    }

    const gmxStakeMintGlpRecipe = new GMXMintStakeGLPRecipe(
      DAI_TOKEN,
      slippagePercentage,
      testRPCProvider,
    );

    const daiAmount: RecipeERC20Amount = {
      ...DAI_TOKEN,
      amount: oneInDecimals18 * 2000n,
    };

    const gmxStakeMintGlpRecipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [daiAmount],
      nfts: [],
    };

    const recipeOutput = await gmxStakeMintGlpRecipe.getRecipeOutput(
      gmxStakeMintGlpRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      gmxStakeMintGlpRecipe.config.name,
      gmxStakeMintGlpRecipeInput,
      recipeOutput,
      2_800_000n, // expectedGasWithin50K
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    // TODO: Add expectations.

    // 2. Add External Balance expectations.
    // N/A
  });
});
