import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeERC20Info,
  RecipeRemoveLiquidityData,
  StepInput,
  UniswapV2Fork,
} from '../../../../models/export-models';
import { UniV2LikeRemoveLiquidityStep } from '../uni-v2-like-remove-liquidity-step';
import { UniV2LikeSDK } from '../../../../api/uni-v2-like/uni-v2-like-sdk';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const uniswapV2Fork = UniswapV2Fork.Uniswap;

// Assume 2000:1 rate.for USDC:WETH.
const USDC_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  decimals: 6n,
};
const WETH_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  decimals: 18n,
};

// Assume 2:1 rate for LP:WETH.
const LP_TOKEN: RecipeERC20Info = {
  tokenAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
  decimals: 18n,
};

const oneInDecimals6 = 10n ** 6n;
const oneInDecimals18 = 10n ** 18n;

const removeLiquidityData: RecipeRemoveLiquidityData = {
  lpERC20Amount: {
    ...LP_TOKEN,
    amount: oneInDecimals18 * 2n,
  },
  expectedERC20AmountA: {
    ...USDC_TOKEN,
    amount: oneInDecimals6 * 2000n,
  },
  expectedERC20AmountB: {
    ...WETH_TOKEN,
    amount: oneInDecimals18 * 1n,
  },
  routerContractAddress: UniV2LikeSDK.getRouterContractAddress(
    uniswapV2Fork,
    networkName,
  ),
  slippageBasisPoints: BigInt(100),
  deadlineTimestamp: 1234567890,
};

describe('uniswap-v2-remove-liquidity-step', () => {
  it('Should create uniswap-v2-remove-liquidity-step step', async () => {
    const step = new UniV2LikeRemoveLiquidityStep(
      UniswapV2Fork.Uniswap,
      removeLiquidityData,
    );

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          expectedBalance: oneInDecimals18 * 2n,
          minBalance: oneInDecimals18 * 2n,
          approvedSpender: removeLiquidityData.routerContractAddress,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Uniswap V2 Remove Liquidity');
    expect(output.description).to.equal(
      'Removes liquidity from a Uniswap V2 Pool.',
    );

    // Spent
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: oneInDecimals18 * 2n,
        recipient: 'Uniswap V2 Pool',
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: LP_TOKEN.decimals,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        expectedBalance: oneInDecimals6 * 2000n,
        minBalance: BigInt('1980000000'),
        tokenAddress: USDC_TOKEN.tokenAddress,
        decimals: USDC_TOKEN.decimals,
        approvedSpender: undefined,
        isBaseToken: false,
      },
      {
        expectedBalance: oneInDecimals18 * 1n,
        minBalance: BigInt('990000000000000000'),
        tokenAddress: WETH_TOKEN.tokenAddress,
        decimals: WETH_TOKEN.decimals,
        approvedSpender: undefined,
        isBaseToken: false,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xbaa2abde000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000001bc16d674ec8000000000000000000000000000000000000000000000000000000000000760467000000000000000000000000000000000000000000000000000dbd2fc137a300000000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a00000000000000000000000000000000000000000000000000000000499602d2',
        to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      },
    ]);
  });

  it('Should test uniswap-v2-remove-liquidity-step step error cases', async () => {
    const step = new UniV2LikeRemoveLiquidityStep(
      UniswapV2Fork.Uniswap,
      removeLiquidityData,
    );

    // Not both matching erc20 inputs
    const stepInputNotBothERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          expectedBalance: oneInDecimals6 * 2n,
          minBalance: oneInDecimals6 * 2n,
          approvedSpender: removeLiquidityData.routerContractAddress,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNotBothERC20s),
    ).to.be.rejectedWith(
      'Uniswap V2 Remove Liquidity step is invalid. No step inputs match filter.',
    );

    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // No spender
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          isBaseToken: true,
          expectedBalance: oneInDecimals18 * 2n,
          minBalance: oneInDecimals18 * 2n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      'Uniswap V2 Remove Liquidity step is invalid. No step inputs match filter.',
    );
  });
});
