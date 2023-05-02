import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXSwapRecipe } from '../zero-x-swap-recipe';
import { BigNumber } from 'ethers';
import { RecipeERC20Info, RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';
import {
  takeGanacheSnapshot,
  restoreGanacheSnapshot,
  createQuickstartCrossContractCallsForTest,
  getTestEthersWallet,
} from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
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

let snapshot: number;

describe.only('FORK-zero-x-swap-recipe', () => {
  before(async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    initCookbook(MOCK_SHIELD_FEE_BASIS_POINTS, MOCK_UNSHIELD_FEE_BASIS_POINTS);
    snapshot = await takeGanacheSnapshot();
  });

  afterEach(async () => {
    await restoreGanacheSnapshot(snapshot);
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

    const quote = recipe.getLatestQuote();
    expect(quote).to.not.be.undefined;

    expect(recipeOutput.stepOutputs.length).to.equal(4);

    const { gasEstimateString, transaction } =
      await createQuickstartCrossContractCallsForTest(
        networkName,
        recipeOutput,
      );

    console.log(gasEstimateString);
    console.log(transaction);

    expect(BigNumber.from(gasEstimateString)).to.be.gte(1_000_000);
    expect(BigNumber.from(gasEstimateString)).to.be.lte(2_000_000);

    const wallet = getTestEthersWallet();
    const txResponse = await wallet.sendTransaction(transaction);
    await txResponse.wait();

    // TODO: Assert things about the transaction
  });
});
