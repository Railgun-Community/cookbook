import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { UniV2LikePairContract } from '../../../../contract/liquidity/uni-v2-like-pair-contract';
import { RecipeERC20Info, RecipeInput } from '../../../../models/export-models';
import { UniswapV2AddLiquidityRecipe } from '../uniswap-v2-add-liquidity-recipe';
import { BaseProvider } from '@ethersproject/providers';

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
  tokenAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
  decimals: 18,
};

// TODO: Date now stub
let uniswapV2PairGetReserves: SinonStub;
let uniswapV2PairTotalSupply: SinonStub;

// Not actually used
let provider: BaseProvider;

describe('uniswap-v2-add-liquidity-recipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    uniswapV2PairGetReserves = Sinon.stub(
      UniV2LikePairContract.prototype,
      'getReserves',
    ).resolves({
      reserveA: oneInDecimals6.mul(2_000_000_000), // USDC
      reserveB: oneInDecimals18.mul(1_000_000), // WETH
    });
    uniswapV2PairTotalSupply = Sinon.stub(
      UniV2LikePairContract.prototype,
      'totalSupply',
    ).resolves(oneInDecimals18.mul(2_000_000));
  });

  after(() => {
    uniswapV2PairGetReserves.restore();
    uniswapV2PairTotalSupply.restore();
  });

  it('Should create uniswap-v2-add-liquidity-recipe', async () => {
    const recipe = new UniswapV2AddLiquidityRecipe(
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      provider,
    );

    const recipeInput: RecipeInput = {
      networkName: networkName,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          amount: oneInDecimals6.mul('2000'),
        },
        {
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          amount: oneInDecimals18.mul('1'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: oneInDecimals6.mul('2000').mul('25').div('10000'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          amount: oneInDecimals18.mul('1').mul('25').div('10000'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputERC20Amounts: [
        {
          expectedBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          minBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          minBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          minBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          minBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: 'approve-usdc',
          to: USDC_TOKEN.tokenAddress,
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          minBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          minBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: 'approve-weth',
          to: WETH_TOKEN.tokenAddress,
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Uniswap V2 Add Liquidity',
      description: 'Adds liquidity to Uniswap V2 Pool.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          expectedBalance: oneInDecimals18.mul('2').mul('9975').div('10000'),
          minBalance: oneInDecimals18
            .mul('2')
            .mul('9975')
            .div('10000')
            .mul('99')
            .div('100'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: 'blem',
          to: 'blem',
        },
      ],
      spentERC20Amounts: [
        {
          amount: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          recipient: 'Uniswap V2 Pool',
        },
        {
          amount: oneInDecimals18.mul('1').mul('9975').div('10000'),
          tokenAddress: WETH_TOKEN.tokenAddress,
          recipient: 'Uniswap V2 Pool',
          decimals: 18,
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[4]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: oneInDecimals18
            .mul('1')
            .mul('9975')
            .div('10000')
            .mul('25')
            .div('10000'),
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          recipient: 'RAILGUN Shield Fee',
        },
      ],
      outputERC20Amounts: [
        {
          expectedBalance: oneInDecimals18
            .mul('1')
            .mul('9975')
            .div('10000')
            .mul('9975')
            .div('10000'),
          minBalance: oneInDecimals18
            .mul('1')
            .mul('9975')
            .div('10000')
            .mul('99')
            .div('100')
            .mul('9975')
            .div('10000'),
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          isBaseToken: undefined,
          approvedSpender: undefined,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.shieldERC20Addresses).to.deep.equal([LP_TOKEN.tokenAddress]);

    expect(output.shieldNFTs).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amount: oneInDecimals6.mul('2000').mul('25').div('10000'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: USDC_TOKEN.tokenAddress,
      },
      {
        amount: oneInDecimals18.mul('1').mul('25').div('10000'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: WETH_TOKEN.tokenAddress,
      },
      {
        amount: oneInDecimals18
          .mul('1')
          .mul('9975')
          .div('10000')
          .mul('25')
          .div('10000'),
        tokenAddress: LP_TOKEN.tokenAddress,
        recipientAddress: 'RAILGUN Shield Fee',
      },
    ]);
  });

  it('Should test uniswap-v2-add-liquidity-recipe error cases', async () => {
    const recipe = new UniswapV2AddLiquidityRecipe(
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      provider,
    );

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: networkName,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress: '0x1234',
          decimals: 18,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'AddLiquidityRecipe first input must contain ERC20 Amount: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    );
  });
});
