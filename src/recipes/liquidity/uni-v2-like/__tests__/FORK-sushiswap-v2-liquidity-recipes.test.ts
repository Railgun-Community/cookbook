import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SushiswapV2AddLiquidityRecipe } from '../sushiswap-v2-add-liquidity-recipe';
import { BigNumber } from 'ethers';
import {
  RecipeAddLiquidityData,
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeInput,
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
import { executeRecipeAndAssertUnshieldBalances } from '../../../../test/common.test';
import { NetworkName } from '@railgun-community/shared-models';
import { getUnshieldedAmountAfterFee } from '../../../../utils/fee';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = BigNumber.from(10).pow(6);
const oneInDecimals18 = BigNumber.from(10).pow(18);
const slippagePercentage = 0.01;

// Assume 2000:1 rate.for USDC:WETH.
const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18,
};

// Assume 2:1 rate for LP:WETH.
const LP_TOKEN: RecipeERC20Info = {
  tokenAddress: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
  decimals: 18,
};

describe.only('FORK-sushiswap-v2-liquidity-recipes', function run() {
  this.timeout(120000);

  before(async function run() {
    if (!process.env.RUN_FORK_TESTS) {
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
    if (!process.env.RUN_FORK_TESTS) {
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
      unshieldRecipeERC20Amounts: [usdcAmount, wethAmount],
      unshieldRecipeNFTs: [],
    };

    const railgunWallet = getTestRailgunWallet();
    const initialPrivateLPTokenBalance = await balanceForERC20Token(
      railgunWallet,
      networkName,
      LP_TOKEN.tokenAddress,
    );

    await executeRecipeAndAssertUnshieldBalances(
      addLiquidityRecipe,
      addLiquidityRecipeInput,
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

    const expectedPrivateVaultTokenBalance = initialPrivateLPTokenBalance
      .add(expectedLPTokenReceived) // LP tokens acquired
      .sub(shieldFee); // Shield fee

    // TODO: Why is this not an exact value?
    // expect(expectedPrivateVaultTokenBalance.toString()).to.equal(
    //   privateLPTokenBalance.toString(),
    //   'Private LP token balance incorrect after adding liquidity',
    // );

    // Within range of 0.00005%
    expect(
      expectedPrivateVaultTokenBalance.lt(privateLPTokenBalance) &&
        expectedPrivateVaultTokenBalance
          .add('1000000000')
          .gt(privateLPTokenBalance),
    ).to.equal(
      true,
      'Private LP token balance incorrect after adding liquidity',
    );

    // 2. Add External Balance expectations.
    // N/A
  });
});
