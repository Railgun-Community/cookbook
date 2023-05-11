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
import { UniswapV2RemoveLiquidityRecipe } from '../uniswap-v2-remove-liquidity-recipe';
import { JsonRpcProvider } from '@ethersproject/providers';

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

let dateStub: SinonStub;
let uniswapV2PairGetReserves: SinonStub;
let uniswapV2PairTotalSupply: SinonStub;

const provider = new JsonRpcProvider(
  'https://eth-mainnet.g.alchemy.com/v2/demo',
);

describe('uniswap-v2-remove-liquidity-recipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    dateStub = Sinon.stub(Date, 'now').returns(100_000_000);
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
    dateStub.restore();
    uniswapV2PairGetReserves.restore();
    uniswapV2PairTotalSupply.restore();
  });

  it('Should create uniswap-v2-remove-liquidity-recipe', async () => {
    const recipe = new UniswapV2RemoveLiquidityRecipe(
      LP_TOKEN,
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      provider,
    );

    const recipeInput: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          amount: oneInDecimals18.mul('2'),
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          amount: oneInDecimals18.mul('2').mul('25').div('10000'),
          recipient: 'RAILGUN Unshield Fee',
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          expectedBalance: oneInDecimals18.mul('2').mul('9975').div('10000'),
          minBalance: oneInDecimals18.mul('2').mul('9975').div('10000'),
          approvedSpender: undefined,
          isBaseToken: undefined,
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
          expectedBalance: oneInDecimals18.mul('2').mul('9975').div('10000'),
          minBalance: oneInDecimals18.mul('2').mul('9975').div('10000'),
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x095ea7b300000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc45ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc',
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Uniswap V2 Remove Liquidity',
      description: 'Removes liquidity from a Uniswap V2 Pool.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          expectedBalance: oneInDecimals6.mul('2000').mul('9975').div('10000'),
          minBalance: oneInDecimals6
            .mul('2000')
            .mul('9975')
            .div('10000')
            .mul('99')
            .div('100'),
          approvedSpender: undefined,
          isBaseToken: false,
        },
        {
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          expectedBalance: oneInDecimals18.mul('1').mul('9975').div('10000'),
          minBalance: oneInDecimals18
            .mul('1')
            .mul('9975')
            .div('10000')
            .mul('99')
            .div('100'),
          approvedSpender: undefined,
          isBaseToken: false,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0xbaa2abde000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000001bafa9ee16e780000000000000000000000000000000000000000000000000000000000075b8df100000000000000000000000000000000000000000000000000db464c15fd150000000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a0000000000000000000000000000000000000000000000000000000005fa74e0',
          to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        },
      ],
      spentERC20Amounts: [
        {
          amount: oneInDecimals18.mul('2').mul('9975').div('10000'),
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          recipient: 'Uniswap V2 Pool',
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: oneInDecimals6
            .mul('2000')
            .mul('9975')
            .div('10000')
            .mul('25')
            .div('10000'),
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          recipient: 'RAILGUN Shield Fee',
        },
        {
          amount: oneInDecimals18
            .mul('1')
            .mul('9975')
            .div('10000')
            .mul('25')
            .div('10000'),
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          recipient: 'RAILGUN Shield Fee',
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          expectedBalance: oneInDecimals6
            .mul('2000')
            .mul('9975')
            .div('10000')
            .mul('9975')
            .div('10000'),
          minBalance: oneInDecimals6
            .mul('2000')
            .mul('9975')
            .div('10000')
            .mul('99')
            .div('100')
            .mul('9975')
            .div('10000'),
          approvedSpender: undefined,
          isBaseToken: false,
        },
        {
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
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
          approvedSpender: undefined,
          isBaseToken: false,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [
        LP_TOKEN.tokenAddress,
        USDC_TOKEN.tokenAddress,
        WETH_TOKEN.tokenAddress,
      ].map(tokenAddress => tokenAddress.toLowerCase()),
    );

    expect(output.nfts).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amount: oneInDecimals18.mul('2').mul('25').div('10000'),
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: LP_TOKEN.decimals,
        recipient: 'RAILGUN Unshield Fee',
      },
      {
        amount: oneInDecimals6
          .mul('2000')
          .mul('9975')
          .div('10000')
          .mul('25')
          .div('10000'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: USDC_TOKEN.tokenAddress,
        decimals: USDC_TOKEN.decimals,
      },
      {
        amount: oneInDecimals18
          .mul('1')
          .mul('9975')
          .div('10000')
          .mul('25')
          .div('10000'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: WETH_TOKEN.tokenAddress,
        decimals: WETH_TOKEN.decimals,
      },
    ]);
  });

  it('Should test uniswap-v2-remove-liquidity-recipe error cases', async () => {
    const recipe = new UniswapV2RemoveLiquidityRecipe(
      LP_TOKEN,
      USDC_TOKEN,
      WETH_TOKEN,
      slippagePercentage,
      provider,
    );

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: '0x1234',
          decimals: 18,
          amount: BigNumber.from('12000'),
        },
      ],
      nfts: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'First input for this recipe must contain ERC20 Amount: 0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc.',
    );
  });
});
