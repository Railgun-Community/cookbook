import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SushiswapV2AddLiquidityRecipe } from '../sushiswap-v2-add-liquidity-recipe';
import { SushiswapV2RemoveLiquidityRecipe } from '../sushiswap-v2-remove-liquidity-recipe';
import { BigNumber } from 'ethers';
import {
  RecipeAddLiquidityData,
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeInput,
  RecipeRemoveLiquidityData,
} from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import {
  getTestRailgunWallet,
  testRPCProvider,
} from '../../../../test/shared.test';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { balanceForERC20Token } from '@railgun-community/quickstart';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../../test/common.test';
import { NetworkName } from '@railgun-community/shared-models';
import { getUnshieldedAmountAfterFee } from '../../../../utils/fee';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = BigNumber.from(10).pow(6);
const oneInDecimals18 = BigNumber.from(10).pow(18);
const slippagePercentage = 0.01;

const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18,
};
const LP_TOKEN: RecipeERC20Info = {
  tokenAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  decimals: 18,
};

describe('FORK-sushiswap-v2-liquidity-recipes', function run() {
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

  it('[FORK] Should run sushiswap-v2-add-liquidity-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }
    if (!testRPCProvider) {
      throw new Error('Requires test rpc provider');
    }

    const addLiquidityRecipe = new SushiswapV2AddLiquidityRecipe(
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      testRPCProvider,
    );

    const usdcAmount: RecipeERC20Amount = {
      tokenAddress: USDC_TOKEN.tokenAddress,
      decimals: USDC_TOKEN.decimals,
      amount: oneInDecimals6.mul(2000),
    };
    const {
      erc20UnshieldAmountB: wethAmount,
      addLiquidityData: preUnshieldAddLiquidityData,
    } = await addLiquidityRecipe.getAddLiquidityAmountBForUnshield(
      networkName,
      usdcAmount,
    );

    // gt 0.5 WETH, lt 2 WETH (expect ratio between 500:1 and 4000:1)
    const halfWETH = oneInDecimals18.mul(5).div(10);
    const twoWETH = oneInDecimals18.mul(2);
    expect(wethAmount.amount.gt(halfWETH)).to.equal(
      true,
      'Lower than expected WETH amount for LP with USDC (expected >0.5 WETH to 2000 USDC)',
    );
    expect(wethAmount.amount.lt(twoWETH)).to.equal(
      true,
      'Higher than expected WETH amount for LP with USDC (expected <2 WETH to 2000 USDC)',
    );

    const addLiquidityRecipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [usdcAmount, wethAmount],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateLPTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      LP_TOKEN.tokenAddress,
    );

    const recipeOutput = await addLiquidityRecipe.getRecipeOutput(
      addLiquidityRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      addLiquidityRecipe.config.name,
      addLiquidityRecipeInput,
      recipeOutput,
      2_800_000, // expectedGasWithin50K
      true, // expectPossiblePrecisionLossOverflow - due to precision loss in the reserve ratios
    );

    const addLiquidityData =
      addLiquidityRecipe.addLiquidityData as RecipeAddLiquidityData;
    assert(
      addLiquidityData != null,
      'addLiquidityData should be defined after recipe execution',
    );

    expect({
      ...addLiquidityData,
      deadlineTimestamp: 1, // Don't compare deadlineTimestamp field.
    }).to.deep.equal(
      {
        ...preUnshieldAddLiquidityData,
        deadlineTimestamp: 1,
      },
      'after-op addLiquidityData should have same data as pre-unshield calculated data',
    );
    expect(
      getUnshieldedAmountAfterFee(networkName, wethAmount.amount).toString(),
    ).to.equal(
      addLiquidityData.erc20AmountB.amount.toString(),
      'Recipe add-liq input B should be expected unshield amount B - Fee.',
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateLPTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      LP_TOKEN.tokenAddress,
    );

    const expectedLPTokenReceived = addLiquidityData.expectedLPAmount.amount;

    const shieldFee = expectedLPTokenReceived
      .mul(MOCK_SHIELD_FEE_BASIS_POINTS)
      .div(10000);

    const expectedPrivateLPTokenBalance = initialPrivateLPTokenBalance
      .add(expectedLPTokenReceived) // LP tokens acquired
      .sub(shieldFee); // Shield fee

    // TODO: Why is this not an exact value?
    // expect(expectedPrivateLPTokenBalance.toString()).to.equal(
    //   privateLPTokenBalance.toString(),
    //   'Private LP token balance incorrect after adding liquidity',
    // );
    expect(
      expectedPrivateLPTokenBalance
        .sub('10000000')
        .lte(privateLPTokenBalance) &&
        expectedPrivateLPTokenBalance
          .add('10000000')
          .gte(privateLPTokenBalance),
    ).to.equal(
      true,
      `Private LP token balance incorrect after adding liquidity, expected ${privateLPTokenBalance.toString()} within 100000000 of ${expectedPrivateLPTokenBalance.toString()}`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });

  it('[FORK] Should run sushiswap-v2-remove-liquidity-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }
    if (!testRPCProvider) {
      throw new Error('Requires test rpc provider');
    }

    const removeLiquidityRecipe = new SushiswapV2RemoveLiquidityRecipe(
      LP_TOKEN,
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      testRPCProvider,
    );

    const preUnshieldLPERC20Amount: RecipeERC20Amount = {
      tokenAddress: LP_TOKEN.tokenAddress,
      decimals: LP_TOKEN.decimals,
      amount: oneInDecimals18.mul(2).div(1000),
    };

    const lpUnshieldedAmount = getUnshieldedAmountAfterFee(
      networkName,
      preUnshieldLPERC20Amount.amount,
    );
    const lpERC20Amount: RecipeERC20Amount = {
      ...preUnshieldLPERC20Amount,
      amount: lpUnshieldedAmount,
    };
    const preUnshieldRemoveLiquidityData =
      await removeLiquidityRecipe.getRemoveLiquidityData(
        networkName,
        lpERC20Amount,
      );

    const ratioAB = preUnshieldRemoveLiquidityData.expectedERC20AmountA.amount
      .mul(oneInDecimals18)
      .div(oneInDecimals6)
      .div(preUnshieldRemoveLiquidityData.expectedERC20AmountB.amount);
    expect(ratioAB.gt('500')).to.equal(
      true,
      'Lower than expected USDC:WETH ratio (expected >500 USDC:WETH)',
    );
    expect(ratioAB.lt('4000')).to.equal(
      true,
      'Higher than expected USDC:WETH ratio (expected <4000 USDC:WETH)',
    );

    const removeLiquidityRecipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [preUnshieldLPERC20Amount],
      nfts: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateTokenABalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      USDC_TOKEN.tokenAddress,
    );
    const initialPrivateTokenBBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      WETH_TOKEN.tokenAddress,
    );

    const recipeOutput = await removeLiquidityRecipe.getRecipeOutput(
      removeLiquidityRecipeInput,
    );
    await executeRecipeStepsAndAssertUnshieldBalances(
      removeLiquidityRecipe.config.name,
      removeLiquidityRecipeInput,
      recipeOutput,
      2_800_000, // expectedGasWithin50K
    );

    const removeLiquidityData =
      removeLiquidityRecipe.removeLiquidityData as RecipeRemoveLiquidityData;
    assert(
      removeLiquidityData != null,
      'removeLiquidityData should be defined after recipe execution',
    );

    expect({
      ...removeLiquidityData,
      deadlineTimestamp: 1, // Don't compare deadlineTimestamp field.
    }).to.deep.equal(
      {
        ...preUnshieldRemoveLiquidityData,
        deadlineTimestamp: 1,
      },
      'after-op removeLiquidityData should have same data as pre-unshield calculated data',
    );

    // REQUIRED TESTS:

    // 1. Add New Private Balance expectations.
    // Expect new swapped token in private balance.

    const privateTokenABalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      USDC_TOKEN.tokenAddress,
    );
    const privateTokenBBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      WETH_TOKEN.tokenAddress,
    );

    const expectedTokenAReceived =
      removeLiquidityData.expectedERC20AmountA.amount;
    const expectedTokenBReceived =
      removeLiquidityData.expectedERC20AmountB.amount;

    const shieldFeeA = expectedTokenAReceived
      .mul(MOCK_SHIELD_FEE_BASIS_POINTS)
      .div(10000);
    const shieldFeeB = expectedTokenBReceived
      .mul(MOCK_SHIELD_FEE_BASIS_POINTS)
      .div(10000);

    const expectedPrivateTokenABalance = initialPrivateTokenABalance
      .add(expectedTokenAReceived) // Token acquired
      .sub(shieldFeeA); // Shield fee
    const expectedPrivateTokenBBalance = initialPrivateTokenBBalance
      .add(expectedTokenBReceived) // Token acquired
      .sub(shieldFeeB); // Shield fee

    expect(privateTokenABalance.toString()).to.equal(
      expectedPrivateTokenABalance.toString(),
      'Private token A balance incorrect after removing liquidity',
    );

    // TODO: Why is this not an exact value?
    // expect(privateTokenBBalance.toString()).to.equal(
    //   expectedPrivateTokenBBalance.toString(),
    //   'Private token B balance incorrect after removing liquidity',
    // );
    expect(
      expectedPrivateTokenBBalance.lte(privateTokenBBalance) &&
        expectedPrivateTokenBBalance.add('5000').gte(privateTokenBBalance),
    ).to.equal(
      true,
      `Private LP token balance incorrect after removing liquidity, expected ${privateTokenBBalance.toString()} within 5000 of ${expectedPrivateTokenBBalance.toString()}`,
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
