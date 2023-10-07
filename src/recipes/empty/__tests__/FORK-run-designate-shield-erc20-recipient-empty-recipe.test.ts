import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeERC20Info, RecipeInput } from '../../../models/export-models';
import {
  NETWORK_CONFIG,
  NetworkName,
  TXIDVersion,
} from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';
import { DesignateShieldERC20RecipientEmptyRecipe } from '../designate-shield-erc20-recipient-empty-recipe';
import { testRailgunWallet2 } from '../../../test/shared.test';
import { balanceForERC20Token } from '@railgun-community/wallet';

chai.use(chaiAsPromised);

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

const erc20Info: RecipeERC20Info = {
  tokenAddress,
  decimals: 18n,
  isBaseToken: false,
};

describe('FORK-designate-shield-erc20-recipient-empty-recipe', function run() {
  this.timeout(60000);

  before(async function run() {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('[FORK] Should run designate-shield-erc20-recipient-empty-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const wallet2 = testRailgunWallet2;
    const privateWalletAddress = wallet2.getAddress();

    const recipe = new DesignateShieldERC20RecipientEmptyRecipe(
      privateWalletAddress,
      [erc20Info],
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };

    const initialPrivateRAILBalance2 = await balanceForERC20Token(
      txidVersion,
      wallet2,
      networkName,
      tokenAddress,
    );

    const recipeOutput = await recipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      recipe.config.name,
      recipeInput,
      recipeOutput,
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    const privateRAILBalance2 = await balanceForERC20Token(
      txidVersion,
      wallet2,
      networkName,
      tokenAddress,
    );
    const originalAmount = 12000n;
    const unshieldFee =
      (originalAmount * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
    const unshieldedAmount = originalAmount - unshieldFee;
    const shieldFee =
      (unshieldedAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;
    const expectedPrivateRAILBalance2 =
      initialPrivateRAILBalance2 +
      unshieldedAmount - // Amount to re-shield
      shieldFee; // Shield fee
    expect(privateRAILBalance2).to.equal(
      expectedPrivateRAILBalance2,
      `Private RAIL balance (wallet 2) incorrect after shield`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
