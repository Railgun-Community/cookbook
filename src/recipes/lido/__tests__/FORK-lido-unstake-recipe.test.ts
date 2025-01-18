import { RecipeERC20Info, RecipeInput } from '../../../models';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
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
import { LidoUnstakeShortcutRecipe } from '../lido-unstake-recipe';
import { LidoWSTETHContract } from '../../../contract/lido';
import { expect } from 'chai';
import { Contract } from 'ethers';

const networkName = NetworkName.Ethereum;
const WSTETH_TOKEN_INFO: RecipeERC20Info = {
  tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  decimals: 18n,
  isBaseToken: false,
};

const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe.only('Lido Liquid Unstaking', () => {
  before(async function () {
    this.timeout(1_000_000);

    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
    const railgunId = getTestRailgunWallet().id;
    await refreshBalances(NETWORK_CONFIG[networkName].chain, [railgunId]);
  });

  it('Should directly unstake wstETH to get WETH', async function () {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const unshieldAmount = 8355n;
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: WSTETH_TOKEN_INFO.tokenAddress,
          decimals: WSTETH_TOKEN_INFO.decimals,
          amount: unshieldAmount,
          isBaseToken: false,
        },
      ],
      nfts: [],
    };

    const provider = getTestProvider();
    const recipe = new LidoUnstakeShortcutRecipe(WSTETH_TOKEN_INFO, provider);

    const { proxyContract: railgun, relayAdaptContract } = NETWORK_CONFIG[networkName];
    console.log("proxyContract", railgun);
    console.log("relayAdaptContract", relayAdaptContract);
    
    const wstETHContract = new LidoWSTETHContract(
      WSTETH_TOKEN_INFO.tokenAddress,
      provider,
    );
    // sanity check.
    const railgunPrevBalance = await wstETHContract.balanceOf(railgun);

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    console.log(recipeOutput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
      true,
    );

    const railgunPostBalance = await wstETHContract.balanceOf(relayAdaptContract);
    console.log(railgunPostBalance, railgunPrevBalance);
    const railgunBalance = railgunPostBalance - railgunPrevBalance;

    const unshieldFee = recipeOutput.feeERC20AmountRecipients[0].amount;
    const amountMinusFee = unshieldAmount - unshieldFee;
    const steth = new Contract('0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', [
      'function balanceOf(address owner) view returns (uint256)',
    ], provider);
    const expectedBalance = await wstETHContract.getStETHByWstETH(
      amountMinusFee,
    );
    const shieldFee = 20n;
    console.log('expectedBalance', expectedBalance.toString());
    const railgunETH_balance = await provider.getBalance(relayAdaptContract);
    const weth = new Contract('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', [
      'function balanceOf(address owner) view returns (uint256)',
    ], provider);
    const railgunsteth_balance = await steth.balanceOf(relayAdaptContract);
    const railgunWETH_balance = await weth.balanceOf(relayAdaptContract);

    console.log('railgunsteth_balance', railgunsteth_balance.toString());
    console.log('railgunETH_balance', railgunETH_balance.toString());
    console.log('railgunWETH_balance', railgunWETH_balance.toString());
    console.log({
      railgunBalance,
      expectedBalance,
      shieldFee,
    });
    
    // expect(expectedBalance - shieldFee).equals(railgunBalance);
  }).timeout(1_000_000);
});
