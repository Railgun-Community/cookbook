import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXSwapRecipe } from '../zero-x-swap-recipe';
import {
  RecipeERC20Info,
  RecipeInput,
  SwapQuoteData,
} from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import { ZeroXQuote } from '../../../api/zero-x';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { ZeroXConfig } from '../../../models/zero-x-config';
import { testConfig } from '../../../test/test-config.test';

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

const slippagePercentage = 0.01;

const VITALIK_WALLET = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';

const quote: SwapQuoteData = {
  sellTokenValue: '10000',
  spender,
  crossContractCall: {
    to: '0x1234',
    value: 0n,
    data: '0x5678',
  },
  buyERC20Amount: {
    tokenAddress: buyTokenAddress,
    decimals: 18n,
    amount: 500n,
  },
  minimumBuyAmount: 495n,

  // base token - 0x's filler address
  sellTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',

  // Unused
  price: 0n,
  guaranteedPrice: 0n,
  slippagePercentage,
};

let stub0xQuote: SinonStub;

describe('zero-x-swap-recipe-public-destination', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
    stub0xQuote = Sinon.stub(ZeroXQuote, 'getSwapQuote').resolves(quote);

    ZeroXConfig.PROXY_API_DOMAIN = testConfig.zeroXProxyApiDomain;
  });

  after(() => {
    stub0xQuote.restore();
  });

  it('Should create zero-x-swap-recipe with amount and public destination address', async () => {
    const recipe = new ZeroXSwapRecipe(
      sellToken,
      buyToken,
      slippagePercentage,
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
      name: '0x Exchange Swap',
      description: 'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
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
          data: '0x5678',
          to: '0x1234',
          value: 0n,
        },
      ],
      spentERC20Amounts: [
        {
          amount: 10000n,
          isBaseToken: false,
          tokenAddress: sellTokenAddress,
          recipient: '0x Exchange',
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
