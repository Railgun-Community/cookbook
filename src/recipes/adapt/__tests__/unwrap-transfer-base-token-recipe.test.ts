import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapTransferBaseTokenRecipe } from '../unwrap-transfer-base-token-recipe';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('unwrap-transfer-base-token-recipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should create unwrap-transfer-base-token-recipe with amount', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
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
          amount: BigNumber.from('30'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: BigNumber.from('11970'),
          minBalance: BigNumber.from('11970'),
          approvedSpender: undefined,
          isBaseToken: false,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Unwrap Base Token',
      description: 'Unwraps wrapped token into base token, ie WETH to ETH.',
      outputERC20Amounts: [
        {
          // Wrapped - ETH
          approvedSpender: undefined,
          isBaseToken: true,
          expectedBalance: amount, // 10000
          minBalance: amount, // 10000
          tokenAddress,
          decimals: 18,
        },
        {
          // Change - WETH
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('1970'),
          minBalance: BigNumber.from('1970'),
          tokenAddress,
          isBaseToken: false,
          decimals: 18,
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
          decimals: 18,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Transfer Base Token',
      description: 'Transfers base token to an external public address.',
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('1970'),
          minBalance: BigNumber.from('1970'),
          tokenAddress,
          isBaseToken: false,
          decimals: 18,
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
          decimals: 18,
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('4'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('1966'),
          minBalance: BigNumber.from('1966'),
          tokenAddress,
          isBaseToken: false,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [tokenAddress].map(tokenAddress => tokenAddress.toLowerCase()),
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
        amount: BigNumber.from('30'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress,
        decimals: 18,
      },
      {
        amount: BigNumber.from('4'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress,
        decimals: 18,
      },
    ]);
  });

  it('Should create unwrap-transfer-base-token-recipe without amount', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress);

    const recipeInput: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('30'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: BigNumber.from('11970'),
          minBalance: BigNumber.from('11970'),
          approvedSpender: undefined,
          isBaseToken: false,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Unwrap Base Token',
      description: 'Unwraps wrapped token into base token, ie WETH to ETH.',
      outputERC20Amounts: [
        {
          // Wrapped - ETH
          approvedSpender: undefined,
          isBaseToken: true,
          expectedBalance: BigNumber.from('11970'),
          minBalance: BigNumber.from('11970'),
          tokenAddress,
          decimals: 18,
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
          decimals: 18,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Transfer Base Token',
      description: 'Transfers base token to an external public address.',
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
          decimals: 18,
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      outputERC20Amounts: [],
      outputNFTs: [],
      feeERC20AmountRecipients: [],
      populatedTransactions: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [tokenAddress].map(tokenAddress => tokenAddress.toLowerCase()),
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
        amount: BigNumber.from('30'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress,
        decimals: 18,
      },
    ]);
  });

  it('Should test unwrap-transfer-base-token-recipe error cases', async () => {
    const recipe = new UnwrapTransferBaseTokenRecipe(toAddress, amount);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName,
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
      'Unwrap Base Token step is invalid. No step inputs match filter.',
    );

    // Too low balance for erc20 input
    const recipeInputTooLow: RecipeInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18,
          isBaseToken: false,
          amount: BigNumber.from('2000'),
        },
      ],
      nfts: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputTooLow)).to.be.rejectedWith(
      'Unwrap Base Token step is invalid. Specified amount 10000 exceeds balance 1995.',
    );
  });
});
