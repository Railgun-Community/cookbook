import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { UniV2LikePairContract } from '../../../../contract/liquidity/uni-v2-like-pair-contract';
import {
  RecipeERC20Info,
  RecipeInput,
  UniswapV2Fork,
} from '../../../../models/export-models';
import { UniV2LikeAddLiquidityRecipe } from '../uni-v2-like-add-liquidity-recipe';
import { JsonRpcProvider } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const oneInDecimals6 = 10n ** 6n;
const oneInDecimals18 = 10n ** 18n;
const slippageBasisPoints = BigInt(100);

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

let dateStub: SinonStub;
let uniswapV2PairGetReserves: SinonStub;
let uniswapV2PairTotalSupply: SinonStub;

const provider = new JsonRpcProvider('https://rpc.ankr.com/eth');

describe('uniswap-v2-add-liquidity-recipe', () => {
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
      reserveA: oneInDecimals6 * 2_000_000_000n, // USDC
      reserveB: oneInDecimals18 * 1_000_000n, // WETH
    });
    uniswapV2PairTotalSupply = Sinon.stub(
      UniV2LikePairContract.prototype,
      'totalSupply',
    ).resolves(oneInDecimals18 * 2_000_000n);
  });

  after(() => {
    dateStub.restore();
    uniswapV2PairGetReserves.restore();
    uniswapV2PairTotalSupply.restore();
  });

  it('Should create uniswap-v2-add-liquidity-recipe', async () => {
    const recipe = new UniV2LikeAddLiquidityRecipe(
      UniswapV2Fork.Uniswap,
      USDC_TOKEN,
      WETH_TOKEN,
      slippageBasisPoints,
      provider,
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          amount: oneInDecimals6 * 2000n,
        },
        {
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
          amount: oneInDecimals18 * 1n,
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(recipe.getExpectedLPAmountFromRecipeOutput(output)).to.deep.equal({
      aUnshieldFee: 5000000n,
      bUnshieldFee: 2500000000000000n,
      lpAmount: 1990012500000000000n,
      lpMinimum: 1970112375000000000n,
      lpShieldFee: 4987500000000000n,
    });

    expect(output.stepOutputs.length).to.equal(5);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield (Default)',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: (oneInDecimals6 * 2000n * 25n) / 10000n,
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          amount: (oneInDecimals18 * 1n * 25n) / 10000n,
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputERC20Amounts: [
        {
          expectedBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          minBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          minBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      outputERC20Amounts: [
        {
          expectedBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          minBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
        {
          expectedBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          minBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          approvedSpender: undefined,
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b300000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc45ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      outputERC20Amounts: [
        {
          expectedBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          minBalance: (oneInDecimals18 * 1n * 9975n) / 10000n,
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: WETH_TOKEN.tokenAddress,
          decimals: WETH_TOKEN.decimals,
        },
        {
          expectedBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          minBalance: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          approvedSpender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
          isBaseToken: undefined,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b300000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc45ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Uniswap V2 Add Liquidity',
      description: 'Adds liquidity to a Uniswap V2 Pool.',
      outputERC20Amounts: [
        {
          expectedBalance: (oneInDecimals18 * 2n * 9975n) / 10000n,
          minBalance: (((oneInDecimals18 * 2n * 9975n) / 10000n) * 99n) / 100n,
          approvedSpender: undefined,
          isBaseToken: false,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xe8e33700000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000dd7d4f70b73c0000000000000000000000000000000000000000000000000000000000076e948c00000000000000000000000000000000000000000000000000db464c15fd150000000000000000000000000000000000000000000000000000000000075b8df100000000000000000000000004025ee6512dbbda97049bcf5aa5d38c54af6be8a0000000000000000000000000000000000000000000000000000000005fa74e0',
          to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        },
      ],
      spentERC20Amounts: [
        {
          amount: (oneInDecimals18 * 1n * 9975n) / 10000n,
          tokenAddress: WETH_TOKEN.tokenAddress,
          recipient: 'Uniswap V2 Pool',
          decimals: 18n,
        },
        {
          amount: (oneInDecimals6 * 2000n * 9975n) / 10000n,
          tokenAddress: USDC_TOKEN.tokenAddress,
          decimals: USDC_TOKEN.decimals,
          recipient: 'Uniswap V2 Pool',
        },
      ],
    });

    expect(output.stepOutputs[4]).to.deep.equal({
      name: 'Shield (Default)',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: (((oneInDecimals18 * 2n * 9975n) / 10000n) * 25n) / 10000n,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          recipient: 'RAILGUN Shield Fee',
        },
      ],
      outputERC20Amounts: [
        {
          expectedBalance:
            (((oneInDecimals18 * 2n * 9975n) / 10000n) * 9975n) / 10000n,
          minBalance:
            (((((oneInDecimals18 * 2n * 9975n) / 10000n) * 99n) / 100n) *
              9975n) /
            10000n,
          tokenAddress: LP_TOKEN.tokenAddress,
          decimals: LP_TOKEN.decimals,
          isBaseToken: false,
          approvedSpender: undefined,
          recipient: undefined,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20AmountRecipients.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [
        USDC_TOKEN.tokenAddress,
        WETH_TOKEN.tokenAddress,
        LP_TOKEN.tokenAddress,
      ].map(tokenAddress => tokenAddress.toLowerCase()),
    );

    expect(output.nftRecipients).to.deep.equal([]);

    const crossContractCallsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.crossContractCalls,
    );
    expect(output.crossContractCalls).to.deep.equal(
      crossContractCallsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amount: (oneInDecimals6 * 2000n * 25n) / 10000n,
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: USDC_TOKEN.tokenAddress,
        decimals: USDC_TOKEN.decimals,
      },
      {
        amount: (oneInDecimals18 * 1n * 25n) / 10000n,
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: WETH_TOKEN.tokenAddress,
        decimals: WETH_TOKEN.decimals,
      },
      {
        amount: (((oneInDecimals18 * 2n * 9975n) / 10000n) * 25n) / 10000n,
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: LP_TOKEN.tokenAddress,
        decimals: LP_TOKEN.decimals,
      },
    ]);
  });

  it('Should test uniswap-v2-add-liquidity-recipe error cases', async () => {
    const recipe = new UniV2LikeAddLiquidityRecipe(
      UniswapV2Fork.Uniswap,
      USDC_TOKEN,
      WETH_TOKEN,
      slippageBasisPoints,
      provider,
    );

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: '0x1234',
          decimals: 18n,
          amount: 12000n,
        },
      ],
      nfts: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'First input for this recipe must contain ERC20 Amount: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.',
    );
  });
});
