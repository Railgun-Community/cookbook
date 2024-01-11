import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UniswapSwapRecipe } from '../uniswap-swap-recipe';
import {
  RecipeERC20Info,
  RecipeInput,
  SwapQuoteData,
} from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import { UniswapQuote } from '../../../api/uni-quote';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { testConfig } from '../../../test/test-config.test';
import { UniswapSwapQuoteData } from '../../../models/uni-quote';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const spender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const sellTokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;
const buyTokenAddress = testConfig.contractsEthereum.rail.toLowerCase();

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress,
  decimals: 18n,
  isBaseToken: false,
};

const buyToken: RecipeERC20Info = {
  tokenAddress: buyTokenAddress,
  decimals: 18n,
};

const slippageBasisPoints = BigInt(100);

const VITALIK_WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const quote: UniswapSwapQuoteData = {
  sellTokenValue: '10000',
  spender,
  crossContractCall: {
    to: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
    value: 0n,
    data: '0x24856bc3000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012000000000000000000000000031e8f645be07584c3c62690258eb4ea11e6cb95b000000000000000000000000000000000000000000000001c9f78d2893e40000000000000000000000000000000000000000000000000f9c1b7b7cfa014a6d8500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000646b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000',
  },
  buyERC20Amount: {
    tokenAddress: buyTokenAddress,
    decimals: 18n,
    amount: 500n,
  },
  minimumBuyAmount: 495n,

  // weth
  sellTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',

  // Unused
  price: 0n,
  guaranteedPrice: 0n,
  slippageBasisPoints,
};

let stub0xQuote: SinonStub;

describe('uniswap-swap-recipe-public-destination', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
    stub0xQuote = Sinon.stub(UniswapQuote, 'getSwapQuote').resolves(quote);

  });

  after(() => {
    stub0xQuote.restore();
  });

  it('Should create uniswap-swap-recipe with amount and public destination address', async () => {
    const recipe = new UniswapSwapRecipe(
      sellToken,
      buyToken,
      slippageBasisPoints,
      VITALIK_WALLET, // destinationAddress
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(5);

    expect(recipe.getBuySellAmountsFromRecipeOutput(output)).to.deep.equal({
      sellUnshieldFee: 30n,
      buyAmount: 500n,
      buyMinimum: 495n,
      buyShieldFee: 0n,
    });

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield (Default)',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: 30n,
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: sellTokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          expectedBalance: 11970n,
          minBalance: 11970n,
          approvedSpender: undefined,
          isBaseToken: false,
          decimals: 18n,
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
          approvedSpender: spender,
          expectedBalance: 11970n,
          minBalance: 11970n,
          tokenAddress: sellTokenAddress,
          isBaseToken: false,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Uniswap Exchange Swap',
      description: 'Swaps two ERC20 tokens using Uniswap Exchange.',
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: 500n,
          minBalance: 495n,
          tokenAddress: buyTokenAddress,
          isBaseToken: undefined,
          decimals: 18n,
        },
        {
          approvedSpender: spender,
          expectedBalance: 1970n,
          minBalance: 1970n,
          tokenAddress: sellTokenAddress,
          isBaseToken: false,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x87517c45000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000003fc91a3afd70395cd496c647d5a6cc9d4b2b7fad00000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000000000065a02b98',
          to: '0x000000000022d473030f116ddee9f6b43ac78ba3',
          value: 0n,
        },
        {
          data: '0x24856bc3000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012000000000000000000000000031e8f645be07584c3c62690258eb4ea11e6cb95b000000000000000000000000000000000000000000000001c9f78d2893e40000000000000000000000000000000000000000000000000f9c1b7b7cfa014a6d8500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000646b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000',
          to: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
          value: 0n,
        },
      ],
      spentERC20Amounts: [
        {
          amount: 10000n,
          isBaseToken: false,
          tokenAddress: sellTokenAddress,
          recipient: 'Uniswap Exchange',
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Transfer ERC20',
      description: 'Transfers ERC20 token to an external public address.',
      outputERC20Amounts: [
        {
          approvedSpender: spender,
          expectedBalance: 1970n,
          minBalance: 1970n,
          tokenAddress: sellTokenAddress,
          isBaseToken: false,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xc2e9ffd8000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e76c6c83af64e4c60245d8c7de953df673a7a33d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
          to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
        },
      ],
      spentERC20Amounts: [
        {
          amount: 500n,
          tokenAddress: buyTokenAddress,
          recipient: VITALIK_WALLET,
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[4]).to.deep.equal({
      name: 'Shield (Default)',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: 4n,
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: sellTokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: spender,
          expectedBalance: 1966n,
          minBalance: 1966n,
          tokenAddress: sellTokenAddress,
          isBaseToken: false,
          decimals: 18n,
          recipient: undefined,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20AmountRecipients.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [sellTokenAddress, buyTokenAddress].map(tokenAddress =>
        tokenAddress.toLowerCase(),
      ),
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
        amount: 30n,
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
      {
        amount: 4n,
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
    ]);
  });
});
