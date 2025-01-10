import { RecipeERC20Info, RecipeInput } from '../../../models';
import { MOCK_RAILGUN_WALLET_ADDRESS, MOCK_UNSHIELD_FEE_BASIS_POINTS, MOCK_SHIELD_FEE_BASIS_POINTS } from '../../../test/mocks.test';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import { executeRecipeStepsAndAssertUnshieldBalances, shouldSkipForkTest } from '../../../test/common.test'
import { getTestProvider, getTestRailgunWallet } from '../../../test/shared.test';
import { refreshBalances } from '@railgun-community/wallet';
import { LidoStakeShortcutRecipe } from '../lido-stake-shortcut-recipe'
import { LidoWSTETHContract } from '../../../contract/lido';
import { expect } from 'chai';

const networkName = NetworkName.Ethereum
const WSTETH_TOKEN_INFO: RecipeERC20Info = {
    tokenAddress: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    decimals: 18n,
    isBaseToken: false
};

const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress

describe("Lido Liquid Staking", () => {

    before(async function () {
        this.timeout(1_000_000);

        setRailgunFees(
            networkName,
            MOCK_SHIELD_FEE_BASIS_POINTS,
            MOCK_UNSHIELD_FEE_BASIS_POINTS,
        );
        const railgunId = getTestRailgunWallet().id
        await refreshBalances(NETWORK_CONFIG[networkName].chain, [railgunId]);
    })

    it("Should directly stake ETH to get wstETH", async function () {
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
                    tokenAddress,
                    decimals: 18n,
                    amount: unshieldAmount,
                    isBaseToken: false
                },
            ],
            nfts: []
        };

        const provider = getTestProvider();
        const recipe = new LidoStakeShortcutRecipe(WSTETH_TOKEN_INFO, provider);

        const { proxyContract: railgun } = NETWORK_CONFIG[networkName];
        const wstETHContract = new LidoWSTETHContract(WSTETH_TOKEN_INFO.tokenAddress, provider);
        const railgunPrevBalance = await wstETHContract.balanceOf(railgun);

        const recipeOutput = await recipe.getRecipeOutput(recipeInput);
        await executeRecipeStepsAndAssertUnshieldBalances(
            recipe.config.name,
            recipeInput,
            recipeOutput,
            true,
        );

        const railgunPostBalance = await wstETHContract.balanceOf(railgun);
        const railgunBalance = railgunPostBalance - railgunPrevBalance;

        const amountMinusFee = unshieldAmount - 25n; // Unshield Fee
        const expectedBalance = await wstETHContract.getWstETHByStETH(amountMinusFee);
        const shieldFee = 20n;
        expect(expectedBalance - shieldFee).equals(railgunBalance);
    }).timeout(1_000_000);
})