import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapTransferBaseTokenRecipe } from '../unwrap-transfer-base-token-recipe';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';

chai.use(chaiAsPromised);
const { expect } = chai;

const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');
const tokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

describe('unwrap-transfer-base-token-recipe', () => {
  before(() => {
    initCookbook('25', '25');
  });

  it('Should create unwrap-transfer-base-token-recipe with amount', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs).to.deep.equal([
      {
        name: 'Unshield',
        description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
        feeERC20AmountRecipients: [
          {
            amount: BigNumber.from('30'),
            recipient: 'RAILGUN Unshield Fee',
            tokenAddress,
          },
        ],
        outputERC20Amounts: [
          {
            tokenAddress,
            expectedBalance: BigNumber.from('11970'),
            minBalance: BigNumber.from('11970'),
            approvedSpender: undefined,
            isBaseToken: false,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [],
        spentERC20Amounts: [],
        spentNFTs: [],
      },
      {
        name: 'Unwrap Base Token',
        description: 'Unwraps wrapped token into base token, ie WETH to ETH.',
        feeERC20AmountRecipients: [],
        outputERC20Amounts: [
          {
            // Wrapped - ETH
            approvedSpender: undefined,
            isBaseToken: true,
            expectedBalance: amount, // 10000
            minBalance: amount, // 10000
            tokenAddress,
          },
          {
            // Change - WETH
            approvedSpender: undefined,
            expectedBalance: BigNumber.from('1970'),
            minBalance: BigNumber.from('1970'),
            tokenAddress,
            isBaseToken: false,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [
          {
            data: '0xd5774a280000000000000000000000000000000000000000000000000000000000002710',
            to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
          },
        ],
        spentERC20Amounts: [
          {
            amount: BigNumber.from('10000'),
            isBaseToken: false,
            recipient: 'Wrapped Token Contract',
            tokenAddress,
          },
        ],
        spentNFTs: [],
      },
      {
        name: 'Transfer Base Token',
        description: 'Transfers base token to an external public address.',
        feeERC20AmountRecipients: [],
        outputERC20Amounts: [
          {
            approvedSpender: undefined,
            expectedBalance: BigNumber.from('1970'),
            minBalance: BigNumber.from('1970'),
            tokenAddress,
            isBaseToken: false,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [
          {
            data: '0xc2e9ffd800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
            to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
          },
        ],
        spentERC20Amounts: [
          {
            amount: BigNumber.from('10000'),
            isBaseToken: true,
            tokenAddress,
            recipient: toAddress,
          },
        ],
        spentNFTs: [],
      },
      {
        name: 'Shield',
        description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
        feeERC20AmountRecipients: [
          {
            amount: BigNumber.from('5'),
            recipient: 'RAILGUN Shield Fee',
            tokenAddress,
          },
        ],
        outputERC20Amounts: [
          {
            approvedSpender: undefined,
            expectedBalance: BigNumber.from('1965'),
            minBalance: BigNumber.from('1965'),
            tokenAddress,
            isBaseToken: false,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [],
        spentERC20Amounts: [],
        spentNFTs: [],
      },
    ]);

    expect(output.shieldERC20Addresses).to.deep.equal([tokenAddress]);

    expect(output.shieldNFTs).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amountString: '30',
        recipientAddress: 'RAILGUN Unshield Fee',
        tokenAddress,
      },
      {
        amountString: '5',
        recipientAddress: 'RAILGUN Shield Fee',
        tokenAddress,
      },
    ]);
  });

  it('Should create unwrap-transfer-base-token-recipe without amount', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress);

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs).to.deep.equal([
      {
        name: 'Unshield',
        description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
        feeERC20AmountRecipients: [
          {
            amount: BigNumber.from('30'),
            recipient: 'RAILGUN Unshield Fee',
            tokenAddress,
          },
        ],
        outputERC20Amounts: [
          {
            tokenAddress,
            expectedBalance: BigNumber.from('11970'),
            minBalance: BigNumber.from('11970'),
            approvedSpender: undefined,
            isBaseToken: false,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [],
        spentERC20Amounts: [],
        spentNFTs: [],
      },
      {
        name: 'Unwrap Base Token',
        description: 'Unwraps wrapped token into base token, ie WETH to ETH.',
        feeERC20AmountRecipients: [],
        outputERC20Amounts: [
          {
            // Wrapped - ETH
            approvedSpender: undefined,
            isBaseToken: true,
            expectedBalance: BigNumber.from('11970'),
            minBalance: BigNumber.from('11970'),
            tokenAddress,
          },
        ],
        outputNFTs: [],
        populatedTransactions: [
          {
            data: '0xd5774a280000000000000000000000000000000000000000000000000000000000000000',
            to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
          },
        ],
        spentERC20Amounts: [
          {
            amount: BigNumber.from('11970'),
            isBaseToken: false,
            recipient: 'Wrapped Token Contract',
            tokenAddress,
          },
        ],
        spentNFTs: [],
      },
      {
        name: 'Transfer Base Token',
        description: 'Transfers base token to an external public address.',
        feeERC20AmountRecipients: [],
        outputERC20Amounts: [],
        outputNFTs: [],
        populatedTransactions: [
          {
            data: '0xc2e9ffd800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
            to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
          },
        ],
        spentERC20Amounts: [
          {
            amount: BigNumber.from('11970'),
            isBaseToken: true,
            tokenAddress,
            recipient: toAddress,
          },
        ],
        spentNFTs: [],
      },
      {
        name: 'Shield',
        description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
        feeERC20AmountRecipients: [],
        outputERC20Amounts: [],
        outputNFTs: [],
        populatedTransactions: [],
        spentERC20Amounts: [],
        spentNFTs: [],
      },
    ]);

    expect(output.shieldERC20Addresses).to.deep.equal([tokenAddress]);

    expect(output.shieldNFTs).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amountString: '30',
        recipientAddress: 'RAILGUN Unshield Fee',
        tokenAddress,
      },
    ]);
  });

  it('Should test unwrap-transfer-base-token-recipe error cases', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts: [
        {
          tokenAddress: '0x1234',
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldNFTs: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'Unwrap Base Token step failed. No erc20 inputs match filter.',
    );

    // Too low balance for erc20 input
    const recipeInputTooLow: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('2000'),
        },
      ],
      unshieldNFTs: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputTooLow)).to.be.rejectedWith(
      'Unwrap Base Token step failed. Specified amount 10000 exceeds balance 1995.',
    );
  });
});
