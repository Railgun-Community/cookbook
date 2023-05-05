import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyDepositRecipe } from '../beefy-deposit-recipe';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import { BeefyAPI, BeefyVaultData } from '../../../api/beefy/beefy-api';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const tokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';

const vault: BeefyVaultData = {
  vaultID: 'id',
  vaultName: 'Vault Name',
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Address: tokenAddress,
  depositERC20Decimals: 18,
  vaultTokenAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultContractAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultRate: '2000000000000000000', // 2x
  depositFee: 0.1,
  withdrawFee: 0,
};

let beefyVaultForIDStub: SinonStub;

describe('beefy-deposit-recipe', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      vault,
    );
  });

  after(() => {
    beefyVaultForIDStub.restore();
  });

  it('Should create beefy-deposit-recipe with amount', async () => {
    const recipe = new BeefyDepositRecipe(vault.vaultID);

    const recipeInput: RecipeInput = {
      networkName: networkName,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress,
          amount: BigNumber.from('10000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(4);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('25'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: BigNumber.from('9975'),
          minBalance: BigNumber.from('9975'),
          approvedSpender: undefined,
          isBaseToken: undefined,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Approve ERC20 Spender',
      description: 'Approves ERC20 for spender contract.',
      feeERC20AmountRecipients: [],
      outputERC20Amounts: [
        {
          approvedSpender: vault.vaultContractAddress,
          expectedBalance: BigNumber.from('9975'),
          minBalance: BigNumber.from('9975'),
          isBaseToken: undefined,
          tokenAddress,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x095ea7b300000000000000000000000040324434a0b53dd1ed167ba30dcb6b4bd7a9536d00000000000000000000000000000000000000000000000000000000000026f7',
          to: tokenAddress,
        },
      ],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress,
          amount: BigNumber.from('997'),
          recipient: 'Vault Name Fee',
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('4489'),
          minBalance: BigNumber.from('4489'),
          tokenAddress: vault.vaultTokenAddress,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0xde5f6268',
          to: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigNumber.from('8978'),
          tokenAddress,
          recipient: 'Vault Name (id)',
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('11'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: vault.vaultTokenAddress,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('4478'),
          minBalance: BigNumber.from('4478'),
          tokenAddress: vault.vaultTokenAddress,
          isBaseToken: undefined,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.shieldERC20Addresses).to.deep.equal([
      tokenAddress,
      vault.vaultTokenAddress,
    ]);

    expect(output.shieldNFTs).to.deep.equal([]);

    const populatedTransactionsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.populatedTransactions,
    );
    expect(output.populatedTransactions).to.deep.equal(
      populatedTransactionsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amountString: '25',
        recipientAddress: 'RAILGUN Unshield Fee',
        tokenAddress,
      },
      {
        amountString: '997',
        recipientAddress: 'Vault Name Fee',
        tokenAddress: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
      },
      {
        amountString: '11',
        recipientAddress: 'RAILGUN Shield Fee',
        tokenAddress: vault.vaultTokenAddress,
      },
    ]);
  });

  it('Should test beefy-deposit-recipe error cases', async () => {
    const recipe = new BeefyDepositRecipe(vault.vaultID);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: networkName,
      unshieldRecipeERC20Amounts: [
        {
          tokenAddress: '0x1234',
          amount: BigNumber.from('12000'),
        },
      ],
      unshieldRecipeNFTs: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'Approve ERC20 Spender step failed. No erc20 inputs match filter.',
    );
  });
});
