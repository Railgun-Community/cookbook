import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import {
  RecipeAddLiquidityData,
  RecipeERC20Info,
  StepInput,
  UniswapV2Fork,
} from '../../../../models/export-models';
import { UniswapV2AddLiquidityStep } from '../uniswap-v2-add-liquidity-step';
import { UniV2LikeSDK } from '../../../../api/uniswap/uni-v2-like-sdk';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const uniswapV2Fork = UniswapV2Fork.Uniswap;

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
  tokenAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
  decimals: 18,
};

const oneInDecimals = BigNumber.from(10).pow(18);

const addLiquidityData: RecipeAddLiquidityData = {
  erc20AmountA: {
    ...USDC_TOKEN,
    amount: oneInDecimals.mul(2000),
  },
  erc20AmountB: {
    ...WETH_TOKEN,
    amount: oneInDecimals.mul(1),
  },
  rateWith18Decimals: oneInDecimals.mul(2000),
  expectedLPAmount: {
    ...LP_TOKEN,
    amount: oneInDecimals.mul(2),
  },
  routerContract: UniV2LikeSDK.getRouterContractAddress(
    uniswapV2Fork,
    networkName,
  ),
  slippagePercentage: 0.01,
  deadlineTimestamp: 1234567890,
};

describe('uniswap-v2-add-liquidity-step', () => {
  it('Should create uniswap-v2-add-liquidity step', async () => {
    const step = new UniswapV2AddLiquidityStep(addLiquidityData);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          expectedBalance: oneInDecimals.mul(2000),
          minBalance: oneInDecimals.mul(2000),
          approvedSpender: addLiquidityData.routerContract,
        },
        {
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          expectedBalance: oneInDecimals.mul(1),
          minBalance: oneInDecimals.mul(1),
          approvedSpender: addLiquidityData.routerContract,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Uniswap V2 Add Liquidity');
    expect(output.description).to.equal(
      'Adds liquidity to a Uniswap V2-like pair.',
    );

    // Spent
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: oneInDecimals.mul(2000),
        recipient: 'Uniswap V2',
        tokenAddress: USDC_TOKEN.tokenAddress,
        decimals: USDC_TOKEN.decimals,
      },
      {
        amount: oneInDecimals.mul(1),
        recipient: 'Uniswap V2',
        tokenAddress: WETH_TOKEN.tokenAddress,
        decimals: WETH_TOKEN.decimals,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        expectedBalance: oneInDecimals.mul(2),
        minBalance: BigNumber.from('1980000000000000000'),
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: 18,
        approvedSpender: undefined,
        isBaseToken: false,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0xe8e33700000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000006c6b935b8bbd4000000000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000006b56051582a97000000000000000000000000000000000000000000000000000000dbd2fc137a300000000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a00000000000000000000000000000000000000000000000000000000499602d2',
        to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      },
    ]);
  });

  it('Should test uniswap-v2-add-liquidity step error cases', async () => {
    const step = new UniswapV2AddLiquidityStep(addLiquidityData);

    // Not both matching erc20 inputs
    const stepInputNotBothERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          expectedBalance: oneInDecimals.mul(2000),
          minBalance: oneInDecimals.mul(2000),
          approvedSpender: addLiquidityData.routerContract,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNotBothERC20s),
    ).to.be.rejectedWith(
      'Uniswap V2 Add Liquidity step failed. Step input does not include a balance for each filtered token.',
    );

    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          isBaseToken: true,
          expectedBalance: oneInDecimals.mul(2000),
          minBalance: oneInDecimals.mul(2000),
          approvedSpender: addLiquidityData.routerContract,
        },
        {
          // No spender
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          isBaseToken: true,
          expectedBalance: oneInDecimals.mul(1),
          minBalance: oneInDecimals.mul(1),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      'Uniswap V2 Add Liquidity step failed. Step input does not include a balance for each filtered token.',
    );
  });
});