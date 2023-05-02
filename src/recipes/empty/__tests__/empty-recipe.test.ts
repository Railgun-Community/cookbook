import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { EmptyRecipe } from '../empty-recipe';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { ZERO_ADDRESS } from '../../../models/constants';

chai.use(chaiAsPromised);
const { expect } = chai;

const tokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

describe.only('empty-recipe', () => {
  before(() => {
    initCookbook(MOCK_SHIELD_FEE_BASIS_POINTS, MOCK_UNSHIELD_FEE_BASIS_POINTS);
  });

  it('Should create empty-recipe with amount', async () => {
    const recipe = new EmptyRecipe();

    const recipeInput: RecipeInput = {
      networkName: NetworkName.Ethereum,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(3);

    expect(output.stepOutputs[0]).to.deep.equal({
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
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Empty Transfer Base Token',
      description:
        'Used for testing. Sends a 0-token transfer to a null address.',
      feeERC20AmountRecipients: [],
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
      populatedTransactions: [
        {
          to: '0x0000000000000000000000000000000000000000',
          value: BigNumber.from(0),
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('29'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('11941'),
          minBalance: BigNumber.from('11941'),
          tokenAddress,
          isBaseToken: false,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

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
        amountString: '29',
        recipientAddress: 'RAILGUN Shield Fee',
        tokenAddress,
      },
    ]);
  });
});
