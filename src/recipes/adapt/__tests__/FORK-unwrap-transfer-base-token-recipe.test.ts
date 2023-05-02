import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapTransferBaseTokenRecipe } from '../unwrap-transfer-base-token-recipe';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';
import {
  takeGanacheSnapshot,
  restoreGanacheSnapshot,
} from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');
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

  it('[FORK] Should create unwrap-transfer-base-token-recipe with amount', async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);
  });

  it('Should create unwrap-transfer-base-token-recipe without amount', async function run() {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress);

    const unshieldERC20Amounts = [
      {
        tokenAddress,
        isBaseToken: false,
        amount: BigNumber.from('12000'),
      },
    ];

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts,
      unshieldNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);

    const { populatedTransactions, shieldERC20Addresses, shieldNFTs } = output;
  });

  after(() => {});
});
