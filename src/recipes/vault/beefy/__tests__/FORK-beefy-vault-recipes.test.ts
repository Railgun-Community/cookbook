import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyDepositRecipe } from '../beefy-deposit-recipe';
import { BeefyWithdrawRecipe } from '../beefy-withdraw-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import { getTestRailgunWallet } from '../../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/wallet';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../../test/common.test';
import { NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../../test/test-config.test';
import { BeefyAPI } from '../../../../api/beefy/beefy-api';
import { compareTokenAddress } from '../../../../utils';
import {
  calculateOutputsForBeefyDeposit,
  calculateOutputsForBeefyWithdraw,
} from '../../../../steps/vault/beefy/beefy-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const vaultID = 'convex-crveth';

const tokenAddress = testConfig.contractsEthereum.crvCRVETH;
const vaultTokenAddress = '0x245186caa063b13d0025891c0d513acf552fb38e';

const oneWithDecimals = 10n ** 18n;

describe('FORK-beefy-vault-recipes', function run() {
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

  it('[FORK] Should run beefy-deposit-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const vault = await BeefyAPI.getBeefyVaultForID(vaultID, networkName);
    expect(
      compareTokenAddress(vault.vaultTokenAddress, vaultTokenAddress),
    ).to.equal(true);

    const depositRecipe = new BeefyDepositRecipe(vaultID);
    const depositRecipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          amount: oneWithDecimals,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateVaultTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      vaultTokenAddress,
    );

    const recipeOutput = await depositRecipe.getRecipeOutput(
      depositRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      depositRecipe.config.name,
      depositRecipeInput,
      recipeOutput,
      2_880_000n, // expectedGasWithin50K
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateVaultTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      vaultTokenAddress,
    );

    const unshieldFee =
      (oneWithDecimals * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
    const depositAmountAfterUnshieldFee = oneWithDecimals - unshieldFee;

    const { receivedVaultTokenAmount } = calculateOutputsForBeefyDeposit(
      depositAmountAfterUnshieldFee,
      vault.depositFeeBasisPoints,
      vault.depositERC20Decimals,
      vault.vaultRate,
    );

    const shieldFee =
      (receivedVaultTokenAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

    const expectedPrivateVaultTokenBalance =
      initialPrivateVaultTokenBalance +
      receivedVaultTokenAmount - // Vault tokens acquired by deposit
      shieldFee; // Shield fee

    expect(expectedPrivateVaultTokenBalance).to.equal(
      privateVaultTokenBalance,
      'Private vault token balance incorrect after deposit',
    );

    // 2. Add External Balance expectations.
    // N/A
  });

  it('[FORK] Should run beefy-withdraw-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const vault = await BeefyAPI.getBeefyVaultForID(vaultID, networkName);
    expect(
      compareTokenAddress(vault.vaultTokenAddress, vaultTokenAddress),
    ).to.equal(true);

    const withdrawRecipe = new BeefyWithdrawRecipe(vaultID);
    const withdrawRecipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
          amount: oneWithDecimals,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    );

    const recipeOutput = await withdrawRecipe.getRecipeOutput(
      withdrawRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      withdrawRecipe.config.name,
      withdrawRecipeInput,
      recipeOutput,
      2_800_000n, // expectedGasWithin50K
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      tokenAddress,
    );

    const unshieldFeeWithdraw =
      (oneWithDecimals * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
    const withdrawAmountAfterUnshieldFee =
      oneWithDecimals - unshieldFeeWithdraw;

    const { withdrawAmountAfterFee } = calculateOutputsForBeefyWithdraw(
      withdrawAmountAfterUnshieldFee,
      vault.withdrawFeeBasisPoints,
      vault.depositERC20Decimals,
      vault.vaultRate,
    );

    const shieldFeeWithdraw =
      (withdrawAmountAfterFee * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

    const expectedPrivateTokenBalance =
      initialTokenBalance +
      withdrawAmountAfterFee - // Vault tokens acquired by withdraw
      shieldFeeWithdraw; // Shield fee

    expect(expectedPrivateTokenBalance).to.equal(
      privateTokenBalance,
      'Private vault token balance incorrect after withdraw',
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
