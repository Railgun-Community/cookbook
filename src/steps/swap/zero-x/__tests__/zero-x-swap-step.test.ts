import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ZeroXSwapStep } from '../zero-x-swap-step';
import { BigNumber } from 'ethers';
import {
  RecipeERC20Info,
  StepInput,
  SwapQuoteData,
} from '../../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { ZeroXConfig } from '../../../../models/zero-x-config';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const spender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const sellTokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;
const buyTokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';
const amount = BigNumber.from('10000');

const sellToken: RecipeERC20Info = {
  tokenAddress: sellTokenAddress,
  isBaseToken: true,
};

const quote: SwapQuoteData = {
  sellTokenValue: '10000',
  spender,
  populatedTransaction: {
    to: '0x1234',
    value: BigNumber.from(0),
    data: '0x5678',
  },
  buyERC20Amount: {
    tokenAddress: buyTokenAddress,
    amount: BigNumber.from('500'),
  },
  minimumBuyAmount: BigNumber.from('495'),

  // base token - 0x's filler address
  sellTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',

  // Unused
  price: BigNumber.from(0),
  guaranteedPrice: BigNumber.from(0),
  slippagePercentage: 0.01,
};

describe('zero-x-swap-step', () => {
  before(() => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
  });

  it('Should create zero-x-swap step with spender', async () => {
    const step = new ZeroXSwapStep(quote, sellToken);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Approved for swapping
          tokenAddress: sellTokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('10000'),
          minBalance: BigNumber.from('10000'),
          approvedSpender: spender,
        },
        {
          // Same token, unapproved
          tokenAddress: sellTokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('2000'),
          minBalance: BigNumber.from('2000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('0x Exchange Swap');
    expect(output.description).to.equal(
      'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
    );

    // Sold
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: true,
        recipient: '0x Exchange',
        tokenAddress: sellTokenAddress,
      },
    ]);

    // Bought
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        isBaseToken: undefined,
        expectedBalance: BigNumber.from('500'),
        minBalance: BigNumber.from('495'),
        tokenAddress: buyTokenAddress,
      },
      {
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: BigNumber.from('2000'),
        minBalance: BigNumber.from('2000'),
        tokenAddress: sellTokenAddress,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0x5678',
        to: '0x1234',
        value: BigNumber.from(0),
      },
    ]);
  });

  it('Should create zero-x-swap step without spender', async () => {
    const step = new ZeroXSwapStep({ ...quote, spender: undefined }, sellToken);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('0x Exchange Swap');
    expect(output.description).to.equal(
      'Swaps two ERC20 tokens using 0x Exchange DEX Aggregator.',
    );

    // Sold
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: true,
        recipient: '0x Exchange',
        tokenAddress: sellTokenAddress,
      },
    ]);

    // Bought
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        isBaseToken: undefined,
        expectedBalance: BigNumber.from('500'),
        minBalance: BigNumber.from('495'),
        tokenAddress: buyTokenAddress,
      },
      {
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: BigNumber.from('2000'),
        minBalance: BigNumber.from('2000'),
        tokenAddress: sellTokenAddress,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0x5678',
        to: '0x1234',
        value: BigNumber.from(0),
      },
    ]);
  });

  it('Should test zero-x-swap step error cases', async () => {
    const step = new ZeroXSwapStep(quote, sellToken);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Non-base token
          tokenAddress: sellTokenAddress,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: spender,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      '0x Exchange Swap step failed. No erc20 inputs match filter.',
    );
    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // No spender
          tokenAddress: sellTokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      '0x Exchange Swap step failed. No erc20 inputs match filter.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: sellTokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('2000'),
          minBalance: BigNumber.from('2000'),
          approvedSpender: spender,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      '0x Exchange Swap step failed. Specified amount 10000 exceeds balance 2000.',
    );
  });
});
