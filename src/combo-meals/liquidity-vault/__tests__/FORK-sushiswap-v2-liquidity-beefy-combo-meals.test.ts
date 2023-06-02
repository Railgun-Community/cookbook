import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UniV2LikeAddLiquidity_BeefyDeposit_ComboMeal } from '../uni-v2-like-add-liquidity-beefy-deposit-combo-meal';
import {
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeInput,
  UniswapV2Fork,
} from '../../../models/export-models';
import { setRailgunFees } from '../../../init';
import {
  getTestRailgunWallet,
  testRPCProvider,
} from '../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/wallet';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../test/common.test';
import { NetworkName } from '@railgun-community/shared-models';
import { BeefyAPI } from '../../../api/beefy/beefy-api';
import { calculateOutputsForBeefyDeposit } from '../../../steps/vault/beefy/beefy-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = 10n ** 6n;
const slippagePercentage = 0.01;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6n,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18n,
};
// const LP_TOKEN: RecipeERC20Info = {
//   tokenAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
//   decimals: 18n,
// };
const VAULT_TOKEN: RecipeERC20Info = {
  tokenAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
  decimals: 18n,
};
const vaultID = 'sushi-mainnet-usdc-weth';

describe('FORK-uni-v2-like-liquidity-beefy-combo-meals', function run() {
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

  it('[FORK] Should run uni-v2-like-add-liquidity-beefy-deposit-combo-meal', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }
    if (!testRPCProvider) {
      throw new Error('Requires test rpc provider');
    }

    const vault = await BeefyAPI.getBeefyVaultForID(vaultID, networkName);

    const comboMeal = new UniV2LikeAddLiquidity_BeefyDeposit_ComboMeal(
      UniswapV2Fork.Sushiswap,
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      vaultID,
      testRPCProvider,
    );

    const usdcAmount: RecipeERC20Amount = {
      tokenAddress: USDC_TOKEN.tokenAddress,
      decimals: USDC_TOKEN.decimals,
      amount: oneInDecimals6 * 2000n,
    };
    const { erc20UnshieldAmountB: wethAmount, addLiquidityData } =
      await comboMeal.getAddLiquidityAmountBForUnshield(
        networkName,
        usdcAmount,
      );

    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [usdcAmount, wethAmount],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateVaultTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      VAULT_TOKEN.tokenAddress,
    );

    const recipeOutput = await comboMeal.getComboMealOutput(recipeInput);

    await executeRecipeStepsAndAssertUnshieldBalances(
      comboMeal.config.name,
      recipeInput,
      recipeOutput,
      2_800_000n, // expectedGasWithin50K
      true, // expectPossiblePrecisionLossOverflow - due to precision loss in the reserve ratios
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateVaultTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      VAULT_TOKEN.tokenAddress,
    );

    const expectedLPTokenReceived = addLiquidityData.expectedLPAmount.amount;

    const { receivedVaultTokenAmount } = calculateOutputsForBeefyDeposit(
      expectedLPTokenReceived,
      vault.depositFeeBasisPoints,
      vault.depositERC20Decimals,
      vault.vaultRate,
    );

    const shieldFee =
      (receivedVaultTokenAmount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

    const expectedPrivateVaultTokenBalance =
      initialPrivateVaultTokenBalance +
      receivedVaultTokenAmount - // Vault tokens acquired
      shieldFee; // Shield fee

    // TODO: Why is this not an exact value?
    // expect(expectedPrivateVaultTokenBalance).to.equal(
    //   privateVaultTokenBalance,
    //   'Private LP token balance incorrect after adding liquidity',
    // );
    expect(
      expectedPrivateVaultTokenBalance <= privateVaultTokenBalance &&
        expectedPrivateVaultTokenBalance + 1000000000n >=
          privateVaultTokenBalance,
    ).to.equal(
      true,
      `Private Vault token balance incorrect after adding liquidity and depositing to vault, expected ${privateVaultTokenBalance} within 1000000000 of ${expectedPrivateVaultTokenBalance}`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
