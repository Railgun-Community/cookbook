import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { DesignateShieldERC20RecipientEmptyRecipe } from '../designate-shield-erc20-recipient-empty-recipe';
import { RecipeERC20Info, RecipeInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_RAILGUN_WALLET_ADDRESS_2,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

const erc20Info: RecipeERC20Info = {
  tokenAddress,
  decimals: 18n,
  isBaseToken: false,
};

describe('shield-empty-recipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should create shield-empty-recipe with amount', async () => {
    const privateWalletAddress = MOCK_RAILGUN_WALLET_ADDRESS_2;

    const recipe = new DesignateShieldERC20RecipientEmptyRecipe(
      privateWalletAddress,
      [erc20Info],
    );

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
          amount: 12000n,
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield (Default)',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: 30n,
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress,
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
      name: 'Empty Transfer Base Token',
      description:
        'Used for testing. Sends a 0-token transfer to a null address.',
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: 11970n,
          minBalance: 11970n,
          approvedSpender: undefined,
          isBaseToken: false,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x',
          to: '0x0000000000000000000000000000000000000000',
          value: 0n,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Designate Shield ERC20s Recipient',
      description:
        'Designates ERC20s to shield into a private RAILGUN balance.',
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: 11970n,
          minBalance: 11970n,
          approvedSpender: undefined,
          isBaseToken: false,
          decimals: 18n,
          recipient: privateWalletAddress,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield (Default)',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: 29n,
          recipient: 'RAILGUN Shield Fee',
          tokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('11941'),
          minBalance: BigInt('11941'),
          tokenAddress,
          isBaseToken: false,
          decimals: 18n,
          recipient: privateWalletAddress,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20AmountRecipients.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [tokenAddress].map(tokenAddress => tokenAddress.toLowerCase()),
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
        tokenAddress,
        decimals: 18n,
      },
      {
        amount: 29n,
        recipient: 'RAILGUN Shield Fee',
        tokenAddress,
        decimals: 18n,
      },
    ]);
  });
});
