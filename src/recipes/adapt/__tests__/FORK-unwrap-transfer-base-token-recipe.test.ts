import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapTransferBaseTokenRecipe } from '../unwrap-transfer-base-token-recipe';
import { BigNumber } from 'ethers';
import { RecipeERC20Amount, RecipeInput } from '../../../models/export-models';
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
  getGanacheProvider,
} from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/quickstart';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const { chain } = NETWORK_CONFIG[networkName];

const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

let initialPrivateWETHBalance: BigNumber;
let initialToAddressETHBalance: BigNumber;

describe('FORK-unwrap-transfer-base-token-recipe', function run() {
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

    const provider = getGanacheProvider();
    initialToAddressETHBalance = await provider.getBalance(toAddress);
  });

  it('[FORK] Should run unwrap-transfer-base-token-recipe with amount', async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    const unshieldRecipeERC20Amounts: RecipeERC20Amount[] = [
      {
        tokenAddress,
        amount: BigNumber.from('12000'),
      },
    ];

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldRecipeERC20Amounts,
      unshieldRecipeNFTs: [],
    };
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

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
    const txReceipt = await txResponse.wait();
    expect(txReceipt.status).to.equal(1);

    // Re-scan private balances
    await delay(5000);
    const railgunWallet = getTestRailgunWallet();
    await railgunWallet.scanBalances(chain, () => {});
    const privateWETHBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    )) as BigNumber;

    const provider = getGanacheProvider();
    const toAddressETHBalance = await provider.getBalance(toAddress);

    //
    // REQUIRED TESTS:
    //

    // 1. Add Private Balance expectations.

    // Expect WETH balance down by unshield amount, up by leftover shielded amount.
    // See unwrap-transfer-base-token-recipe.test.ts for these exact amounts in step outputs.
    const expectedPrivateWETHBalance = initialPrivateWETHBalance
      .sub('12000') // Unshielded amount
      .add('1966'); // Shielded amount
    expect(privateWETHBalance.toString()).to.equal(
      expectedPrivateWETHBalance.toString(),
    );

    // 2. Add External Balance expectations.

    const expectedToAddressETHBalance = initialToAddressETHBalance.add(amount); // Sent amount
    expect(toAddressETHBalance.toString()).to.equal(
      expectedToAddressETHBalance.toString(),
    );
  });

  it('[FORK] Should run unwrap-transfer-base-token-recipe without amount', async function run() {
    if (!process.env.RUN_GANACHE_TESTS) {
      this.skip();
      return;
    }

    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress);

    const unshieldRecipeERC20Amounts: RecipeERC20Amount[] = [
      {
        tokenAddress,
        amount: BigNumber.from('12000'),
      },
    ];

    const recipeInput: RecipeInput = {
      networkName,
      unshieldRecipeERC20Amounts,
      unshieldRecipeNFTs: [],
    };
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

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
    const txReceipt = await txResponse.wait();
    expect(txReceipt.status).to.equal(1);

    // Re-scan private balances
    await delay(5000);
    const railgunWallet = getTestRailgunWallet();
    await railgunWallet.scanBalances(chain, () => {});
    const privateWETHBalance = (await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    )) as BigNumber;

    const provider = getGanacheProvider();
    const toAddressETHBalance = await provider.getBalance(toAddress);

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

    // 2. Add External Balance expectations.

    const expectedToAddressETHBalance = initialToAddressETHBalance.add('11970'); // Full unshield balance minus fee
    expect(toAddressETHBalance.toString()).to.equal(
      expectedToAddressETHBalance.toString(),
    );
  });
});
