import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
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
import { EmptyRecipe } from '../empty-recipe';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

let snapshot: number;

describe.only('FORK-unwrap-transfer-base-token-recipe', () => {
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
