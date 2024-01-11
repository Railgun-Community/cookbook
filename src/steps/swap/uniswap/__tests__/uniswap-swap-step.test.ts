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

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress,
  decimals: 18n,
  isBaseToken: true,
};

const quote: UniswapSwapQuoteData = {
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
  slippageBasisPoints: 100n,
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
        data: '0x5678',
        to: '0x1234',
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
        data: '0x5678',
        to: '0x1234',
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
