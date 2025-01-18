import { LidoStakeRecipe } from '../lido-stake-recipe-deprecated';
import { RecipeERC20Info, RecipeInput } from '../../../models';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { expect } from 'chai';
import { setRailgunFees } from '../../../init';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';
import {
  getTestProvider,
  getTestRailgunWallet,
} from '../../../test/shared.test';
import { refreshBalances } from '@railgun-community/wallet';
import { LidoWSTETHContract, LidoSTETHContract } from '../../../contract/lido';

const networkName = NetworkName.Ethereum;
const STETH_TOKEN_INFO: RecipeERC20Info = {
  tokenAddress: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  decimals: 18n,
};

const WSTETH_TOKEN_INFO: RecipeERC20Info = {
  tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  decimals: 18n,
  isBaseToken: false,
};

const baseTokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('Stake ETH to get stETH and wrap it to wstETH', () => {
  before(async function () {
    this.timeout(100_000);
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    // @TODO syncing balance at the start of test doesn't reflect the balance, we have to resync it again
    const railgunId = getTestRailgunWallet().id;
    await refreshBalances(NETWORK_CONFIG[networkName].chain, [railgunId]);
  });

  it('[FORK] Should stake ETH to get stETH', async function () {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const unshieldAmount = 10000n;
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: baseTokenAddress,
          decimals: 18n,
          amount: unshieldAmount,
        },
      ],
      nfts: [],
    };

    const provider = getTestProvider();

    const recipe = new LidoStakeRecipe(
      STETH_TOKEN_INFO,
      WSTETH_TOKEN_INFO,
      provider,
    );
    const recipeOutput = await recipe.getRecipeOutput(recipeInput);

    const { proxyContract: railgun, relayAdaptContract } =
      NETWORK_CONFIG[networkName];
    const wstETHContract = new LidoWSTETHContract(
      WSTETH_TOKEN_INFO.tokenAddress,
      provider,
    );
    const railgunPrevBalance = await wstETHContract.balanceOf(railgun);

    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
      true,
    );

    const stETHContract = new LidoSTETHContract(
      STETH_TOKEN_INFO.tokenAddress,
      provider,
    );

    const stETHBalance = await stETHContract.balanceOf(relayAdaptContract);
    expect(stETHBalance).equal(0n);

    const stETHShares = await stETHContract.sharesOf(relayAdaptContract);
    expect(stETHShares).equal(0n);

    const railgunPostBalance = await wstETHContract.balanceOf(railgun);
    const railgunBalance = railgunPostBalance - railgunPrevBalance;

    const unshieldFee = 25n;
    const amountMinusUnshieldFee = unshieldAmount - unshieldFee; // Unshield fee
    const shieldFee = 20n;

    const expectedBalance = await wstETHContract.getWstETHByStETH(
      amountMinusUnshieldFee,
    );
    expect(expectedBalance - shieldFee).equals(railgunBalance);
  }).timeout(100_000);
});
