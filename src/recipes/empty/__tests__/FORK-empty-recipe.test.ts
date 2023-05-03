import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import {
  NETWORK_CONFIG,
  NetworkName,
  delay,
} from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';
import {
  createQuickstartCrossContractCallsForTest,
  getTestEthersWallet,
  getTestRailgunWallet,
} from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { EmptyRecipe } from '../empty-recipe';
import { balanceForERC20Token } from '@railgun-community/quickstart';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const { chain } = NETWORK_CONFIG[networkName];

const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

let initialPrivateWETHBalance: BigNumber;

describe('FORK-empty-recipe', function run() {
  this.timeout(120000);

  before(async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    initCookbook(MOCK_SHIELD_FEE_BASIS_POINTS, MOCK_UNSHIELD_FEE_BASIS_POINTS);
  });

  beforeEach(async () => {
    // Get initial balances for comparison.
    const railgunWallet = getTestRailgunWallet();
    initialPrivateWETHBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    )) as BigNumber;
    assert(initialPrivateWETHBalance != null);
  });

  it('[FORK] Should run empty-recipe', async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    const recipe = new EmptyRecipe();

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

    expect(recipeOutput.stepOutputs.length).to.equal(3);

    const { gasEstimateString, transaction } =
      await createQuickstartCrossContractCallsForTest(
        networkName,
        recipeOutput,
      );

    expect(BigNumber.from(gasEstimateString).toNumber()).to.be.gte(2_750_000);
    expect(BigNumber.from(gasEstimateString).toNumber()).to.be.lte(2_850_000);

    const wallet = getTestEthersWallet();
    const txResponse = await wallet.sendTransaction(transaction);
    await txResponse.wait();

    // Re-scan private balances
    await delay(5000);
    const railgunWallet = getTestRailgunWallet();
    await railgunWallet.scanBalances(chain, () => {});
    const privateWETHBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    )) as BigNumber;

    //
    // REQUIRED TESTS:
    //

    // 1. Add Private Balance expectations.

    // Expect WETH balance down by unshield amount, up by leftover shielded amount.
    // See unwrap-transfer-base-token-recipe.test.ts for these exact amounts in step outputs.
    const expectedPrivateWETHBalance = initialPrivateWETHBalance
      .sub('12000') // Unshielded amount
      .add('11941'); // Shielded amount
    expect(privateWETHBalance.toString()).to.equal(
      expectedPrivateWETHBalance.toString(),
    );

    // 2. Add External Balance expectations.

    // N/A
  });
});
