import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapTransferBaseTokenRecipe } from '../unwrap-transfer-base-token-recipe';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import { getGanacheProvider } from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';
import { ERC20Contract } from '../../../contract';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = 10000n;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('FORK-unwrap-transfer-base-token-recipe', function run() {
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

  it('[FORK] Should run unwrap-transfer-base-token-recipe with amount', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);
    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const provider = getGanacheProvider();
    const initialToAddressETHBalance = await provider.getBalance(toAddress);

    const railgun = NETWORK_CONFIG[networkName].proxyContract;
    const token = new ERC20Contract(tokenAddress, provider);
    const railgunPreBalance = await token.balanceOf(railgun);

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
      2_800_000n, // expectedGasWithin50K
    );

    const expectedRailgunPostBalance = railgunPreBalance - 12000n + 1966n;
    const railgunPostBalance = await token.balanceOf(railgun);
    expect(expectedRailgunPostBalance).to.equal(railgunPostBalance);

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // N/A

    // 2. Add External Balance expectations.

    const toAddressETHBalance = await provider.getBalance(toAddress);
    const expectedToAddressETHBalance: bigint =
      initialToAddressETHBalance + amount; // Sent amount
    expect(toAddressETHBalance).to.equal(expectedToAddressETHBalance);
  });

  it('[FORK] Should run unwrap-transfer-base-token-recipe without amount', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress);
    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const provider = getGanacheProvider();
    const initialToAddressETHBalance = await provider.getBalance(toAddress);

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
      2_800_000n, // expectedGasWithin50K
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // N/A

    // 2. Add External Balance expectations.

    const toAddressETHBalance = await provider.getBalance(toAddress);
    const expectedToAddressETHBalance: bigint =
      initialToAddressETHBalance + 11970n; // Full unshield balance minus fee
    expect(toAddressETHBalance).to.equal(
      expectedToAddressETHBalance,
      'to-address ETH balance is incorrect',
    );
  });
});
