import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXSwapRecipe } from '../zero-x-swap-recipe';
import { BigNumber } from 'ethers';
import { RecipeERC20Info, RecipeInput } from '../../../models/export-models';
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
import { balanceForERC20Token } from '@railgun-community/quickstart';
import { ZeroXSwapQuoteData } from '../../../api/zero-x';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const { chain } = NETWORK_CONFIG[networkName];
const sellTokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;
const buyTokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress, // WETH
  isBaseToken: false,
};

const buyToken: RecipeERC20Info = {
  tokenAddress: buyTokenAddress, // RAIL
};

const slippagePercentage = 0.01;

let initialPrivateWETHBalance: BigNumber;
let initialPrivateRAILBalance: BigNumber;

describe('FORK-zero-x-swap-recipe', function run() {
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
      sellToken.tokenAddress,
    )) as BigNumber;
    assert(initialPrivateWETHBalance != null);

    initialPrivateRAILBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
    )) as BigNumber;
    assert(initialPrivateRAILBalance != null);
  });

  it('[FORK] Should run zero-x-swap-recipe', async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    const recipe = new ZeroXSwapRecipe(sellToken, buyToken, slippagePercentage);

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

    const quote = recipe.getLatestQuote() as ZeroXSwapQuoteData;
    expect(quote).to.not.be.undefined;

    expect(recipeOutput.stepOutputs.length).to.equal(4);

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
      sellToken.tokenAddress,
    )) as BigNumber;
    const privateRAILBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
    )) as BigNumber;

    //
    // REQUIRED TESTS:
    //

    // 1. Add Private Balance expectations.

    // Expect WETH balance down by unshield amount, up by leftover shielded amount.
    // See unwrap-transfer-base-token-recipe.test.ts for these exact amounts in step outputs.
    const expectedPrivateWETHBalance = initialPrivateWETHBalance
      .sub('12000') // Unshielded amount
      .add('0'); // Shielded amount
    expect(privateWETHBalance.toString()).to.equal(
      expectedPrivateWETHBalance.toString(),
    );

    const minimumBuyAmount = quote.minimumBuyAmount;
    const minimumShieldFee = minimumBuyAmount
      .mul(MOCK_SHIELD_FEE_BASIS_POINTS)
      .div(10000);
    const expectedPrivateRAILBalance = initialPrivateRAILBalance
      .add(minimumBuyAmount) // Minimum buy amount
      .sub(minimumShieldFee); // Shield fee
    expect(privateRAILBalance.gte(expectedPrivateRAILBalance)).to.equal(
      true,
      'Private RAIL balance incorrect after swap',
    );

    // 2. Add External Balance expectations.

    // N/A
  });
});
