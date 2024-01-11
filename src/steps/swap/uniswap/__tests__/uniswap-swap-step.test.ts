import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UniswapSwapStep } from '../uniswap-swap-step';

import {
  RecipeERC20Info,
  StepInput,
  SwapQuoteData,
} from '../../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../../test/test-config.test';
import { UniswapSwapQuoteData } from '../../../../models/uni-quote';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const spender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const sellTokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;
const buyTokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';
const amount = 10000n;
const slippageBasisPoints = BigInt(100);

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress,
  decimals: 18n,
  isBaseToken: true,
};

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

describe('uniswap-swap-step', () => {
  // before(() => {
  //   console.log("Starting Uniswap Testing")
  // });

  it('Should create uniswap-swap step with spender', async () => {
    const step = new UniswapSwapStep(quote, sellToken);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Approved for swapping
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 10000n,
          minBalance: 10000n,
          approvedSpender: spender,
        },
        {
          // Same token, unapproved
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 2000n,
          minBalance: 2000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Uniswap Exchange Swap');
    expect(output.description).to.equal(
      'Swaps two ERC20 tokens using Uniswap Exchange.',
    );

    // Sold
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: true,
        recipient: 'Uniswap Exchange',
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
    ]);

    // Bought
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        isBaseToken: undefined,
        expectedBalance: 500n,
        minBalance: 495n,
        tokenAddress: buyTokenAddress,
        decimals: 18n,
      },
      {
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: 2000n,
        minBalance: 2000n,
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
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
    ]);
  });

  it('Should create uniswap-swap step without spender', async () => {
    const step = new UniswapSwapStep({ ...quote, spender: undefined }, sellToken);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Uniswap Exchange Swap');
    expect(output.description).to.equal(
      'Swaps two ERC20 tokens using Uniswap Exchange.',
    );

    // Sold
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: true,
        recipient: 'Uniswap Exchange',
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
    ]);

    // Bought
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        isBaseToken: undefined,
        expectedBalance: 500n,
        minBalance: 495n,
        tokenAddress: buyTokenAddress,
        decimals: 18n,
      },
      {
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: 2000n,
        minBalance: 2000n,
        tokenAddress: sellTokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
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
    ]);
  });

  it('Should test uniswap-swap step error cases', async () => {
    const step = new UniswapSwapStep(quote, sellToken);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Non-base token
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: spender,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Uniswap Exchange Swap step is invalid.',
    );
    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // No spender
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      'Uniswap Exchange Swap step is invalid.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 2000n,
          minBalance: 2000n,
          approvedSpender: spender,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      'Uniswap Exchange Swap step is invalid.',
    );
  });
});
