import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyDepositRecipe } from '../beefy-deposit-recipe';
import { BeefyWithdrawRecipe } from '../beefy-withdraw-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import {
  getTestProvider,
  getTestRailgunWallet,
} from '../../../../test/shared.test';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/wallet';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../../test/common.test';
import { NetworkName, TXIDVersion } from '@railgun-community/shared-models';
import { testConfig } from '../../../../test/test-config.test';
import { BeefyAPI } from '../../../../api/beefy/beefy-api';
import { compareTokenAddress } from '../../../../utils';
import {
  calculateOutputsForBeefyDeposit,
  calculateOutputsForBeefyWithdraw,
} from '../../../../steps/vault/beefy/beefy-util';
import { ERC20Contract } from '../../../../contract';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;
const vaultID = 'convex-tricrypto-usdc';

const tokenAddress = testConfig.contractsEthereum.crvUSDCWBTCWETH;
const vaultERC20Address = testConfig.contractsEthereum.mooConvexTriCryptoUSDC;

const oneWithDecimals = 10n ** 18n;

describe('FORK-run-beefy-vault-recipes', function run() {
  this.timeout(60000);

  before(async function run() {
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
      compareTokenAddress(vault.vaultERC20Address, vaultERC20Address),
    ).to.equal(true);

    const depositRecipe = new BeefyDepositRecipe(vaultID);
    expect(depositRecipe.id.length).to.equal(16);

    const depositRecipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
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
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;
    const initialPrivateVaultTokenBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultERC20Address,
      false, // onlySpendable - not required for tests
    );

    const provider = getTestProvider();
    const vaultERC20 = new ERC20Contract(vaultERC20Address, provider);
    const preTreasuryVaultBalance = await vaultERC20.balanceOf(
      testConfig.contractsEthereum.treasuryProxy,
    );

    const recipeOutput = await depositRecipe.getRecipeOutput(
      depositRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      depositRecipe.config.name,
      depositRecipeInput,
      recipeOutput,
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateVaultTokenBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultERC20Address,
      false, // onlySpendable - not required for tests
    );

    const unshieldFee =
      (oneWithDecimals * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
    const depositAmountAfterUnshieldFee = oneWithDecimals - unshieldFee;

    const { receivedVaultTokenAmount } = calculateOutputsForBeefyDeposit(
      depositAmountAfterUnshieldFee,
      vault,
    );

    const shieldFee =
      (receivedVaultTokenAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

    const postTreasuryVaultBalance = await vaultERC20.balanceOf(
      testConfig.contractsEthereum.treasuryProxy,
    );
    expect(postTreasuryVaultBalance).to.equal(
      preTreasuryVaultBalance + shieldFee,
      'Treasury balance incorrect after shield',
    );

    const expectedPrivateVaultTokenBalance =
      initialPrivateVaultTokenBalance +
      receivedVaultTokenAmount - // Vault tokens acquired by deposit
      shieldFee; // Shield fee

    // vaultRate is a rounded value from Beefy API, so we need to check this adjusted value (see comments in beefy-util.test.ts).
    const expectedStartRange = expectedPrivateVaultTokenBalance - 1n;
    const expectedEndRange = expectedPrivateVaultTokenBalance + 1n;
    expect(
      privateVaultTokenBalance >= expectedStartRange ||
        privateVaultTokenBalance <= expectedEndRange,
    ).to.equal(
      true,
      `Private vault token balance incorrect after deposit, got ${privateVaultTokenBalance}, expected ${expectedStartRange} - ${expectedEndRange}`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });

  // NOTE: There's a chance that the deposit conflicts with this withdraw function.
  // We may have to run withdraw on a different vault.
  it('[FORK] Should run beefy-withdraw-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const vault = await BeefyAPI.getBeefyVaultForID(vaultID, networkName);
    expect(
      compareTokenAddress(vault.vaultERC20Address, vaultERC20Address),
    ).to.equal(true);

    const withdrawRecipe = new BeefyWithdrawRecipe(vaultID);
    expect(withdrawRecipe.id.length).to.equal(16);

    const withdrawRecipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultERC20Address,
          decimals: 18n,
          amount: oneWithDecimals,
        },
      ],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialTokenBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const provider = getTestProvider();
    const depositERC20 = new ERC20Contract(tokenAddress, provider);
    const preTreasuryVaultBalance = await depositERC20.balanceOf(
      testConfig.contractsEthereum.treasuryProxy,
    );

    const recipeOutput = await withdrawRecipe.getRecipeOutput(
      withdrawRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      withdrawRecipe.config.name,
      withdrawRecipeInput,
      recipeOutput,
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateTokenBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      tokenAddress,
      false, // onlySpendable - not required for tests
    );

    const unshieldFeeWithdraw =
      (oneWithDecimals * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
    const withdrawAmountAfterUnshieldFee =
      oneWithDecimals - unshieldFeeWithdraw;

    const { withdrawAmountAfterFee } = calculateOutputsForBeefyWithdraw(
      withdrawAmountAfterUnshieldFee,
      vault,
    );

    const shieldFeeWithdraw =
      (withdrawAmountAfterFee * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

    const postTreasuryVaultBalance = await depositERC20.balanceOf(
      testConfig.contractsEthereum.treasuryProxy,
    );
    expect(postTreasuryVaultBalance).to.equal(
      preTreasuryVaultBalance + shieldFeeWithdraw,
      'Treasury balance incorrect after shield',
    );

    const expectedPrivateTokenBalance =
      initialTokenBalance +
      withdrawAmountAfterFee - // Vault tokens acquired by withdraw
      shieldFeeWithdraw; // Shield fee

    // vaultRate is a rounded value from Beefy API, so we need to check this adjusted value (see comments in beefy-util.test.ts).
    const expectedStartRange = expectedPrivateTokenBalance - 1n;
    const expectedEndRange = expectedPrivateTokenBalance + 1n;
    expect(
      privateTokenBalance >= expectedStartRange ||
        privateTokenBalance <= expectedEndRange,
    ).to.equal(
      true,
      `Private vault token balance incorrect after withdraw, got ${privateTokenBalance}, expected ${expectedStartRange} - ${expectedEndRange}`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
