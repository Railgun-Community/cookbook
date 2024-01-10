import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UniswapSwapRecipe } from '../uniswap-swap-recipe';
import {
  RecipeERC20Info,
  RecipeInput,
  SwapQuoteData,
} from '../../../models/export-models';
import {
  NETWORK_CONFIG,
  NetworkName,
  TXIDVersion,
} from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  getTestProvider,
  getTestRailgunWallet,
  getTestRailgunWallet2,
  testRailgunWallet2,
} from '../../../test/shared.test';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/wallet';
import { UniswapQuote } from '../../../api/uni-quote';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';
import { ERC20Contract } from '../../../contract/token/erc20-contract';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;
const sellTokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;
const buyTokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress, // WETH
  decimals: 18n,
  isBaseToken: false,
};

const buyToken: RecipeERC20Info = {
  tokenAddress: buyTokenAddress, // RAIL
  decimals: 18n,
};

const VITALIK_WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const slippageBasisPoints = 100n;

describe('FORK-run-uniswap-swap-recipe', function run() {
  this.timeout(60000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should run uniswap-swap-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new UniswapSwapRecipe(
      sellToken,
      buyToken,
      slippageBasisPoints,
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const quote = recipe.getLatestQuote() as SwapQuoteData;
    expect(quote).to.not.be.undefined;
    const expectedSpender =
      UniswapQuote.getUniswapPermit2ContractAddressForNetwork(networkName);
    expect(quote.spender).to.equal(
      expectedSpender,
      '0x Exchange contract does not match.',
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const minimumBuyAmount = quote.minimumBuyAmount;
    const minimumShieldFee =
      (minimumBuyAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;
    const expectedPrivateRAILBalance =
      initialPrivateRAILBalance +
      minimumBuyAmount - // Minimum buy amount
      minimumShieldFee; // Shield fee
    expect(privateRAILBalance >= expectedPrivateRAILBalance).to.equal(
      true,
      'Private RAIL balance incorrect after swap',
    );

    // 2. Add External Balance expectations.
    // N/A
  });

  it('[FORK] Should run uniswap-swap-recipe with public destination address', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const recipe = new UniswapSwapRecipe(
      sellToken,
      buyToken,
      slippageBasisPoints,
      VITALIK_WALLET,
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const quote = recipe.getLatestQuote() as SwapQuoteData;
    expect(quote).to.not.be.undefined;
    const expectedSpender =
      UniswapQuote.getUniswapPermit2ContractAddressForNetwork(networkName);
    expect(quote.spender).to.equal(
      expectedSpender,
      '0x Exchange contract does not match.',
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect no change in private balance.

    const privateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const expectedPrivateRAILBalance = initialPrivateRAILBalance;
    expect(privateRAILBalance === expectedPrivateRAILBalance).to.equal(
      true,
      'Private RAIL balance incorrect after swap - should not change after transfer',
    );

    // 2. Add External Balance expectations.
    // Expect new swapped token in destination public balance.

    const provider = getTestProvider();
    const token = new ERC20Contract(buyToken.tokenAddress, provider);
    const publicDestinationRAILBalance = await token.balanceOf(VITALIK_WALLET);
    const minimumBuyAmount = quote.minimumBuyAmount;
    expect(publicDestinationRAILBalance >= minimumBuyAmount).to.equal(
      true,
      'Destination wallet RAIL balance incorrect after swap',
    );
  });

  it('[FORK] Should run uniswap-swap-recipe with private destination address', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const privateWalletAddress = testRailgunWallet2.getAddress();

    const recipe = new UniswapSwapRecipe(
      sellToken,
      buyToken,
      slippageBasisPoints,
      privateWalletAddress,
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const railgunWallet2 = getTestRailgunWallet2();
    const initialPrivateRAILBalance2 = await balanceForERC20Token(
      txidVersion,
      railgunWallet2,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const quote = recipe.getLatestQuote() as SwapQuoteData;
    expect(quote).to.not.be.undefined;
    const expectedSpender =
      UniswapQuote.getUniswapPermit2ContractAddressForNetwork(networkName);
    expect(quote.spender).to.equal(
      expectedSpender,
      '0x Exchange contract does not match.',
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect no change in private balance.

    // Check origin wallet balance
    const privateRAILBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );
    const expectedPrivateRAILBalance = initialPrivateRAILBalance;
    expect(privateRAILBalance === expectedPrivateRAILBalance).to.equal(
      true,
      'Private RAIL balance (wallet 1) incorrect after swap - should not change after transfer',
    );

    // Check destination wallet balance
    const privateRAILBalance2 = await balanceForERC20Token(
      txidVersion,
      railgunWallet2,
      networkName,
      buyToken.tokenAddress,
      false, // onlySpendable - not required for tests
    );
    const minimumBuyAmount = quote.minimumBuyAmount;
    const minimumShieldFee =
      (minimumBuyAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;
    const expectedPrivateRAILBalance2 =
      initialPrivateRAILBalance2 +
      minimumBuyAmount - // Minimum buy amount
      minimumShieldFee; // Shield fee
    expect(privateRAILBalance2 >= expectedPrivateRAILBalance2).to.equal(
      true,
      `Private RAIL balance (wallet 2) incorrect after swap, expected ${privateRAILBalance2} >= ${expectedPrivateRAILBalance2}`,
    );
  });
});
