import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyWithdrawRecipe } from '../beefy-withdraw-recipe';
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
import { testConfig } from '../../../test/test-config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const tokenAddress = testConfig.contractsEthereum.rail.toLowerCase();

const vault: BeefyVaultData = {
  vaultID: 'id',
  vaultName: 'VAULT_NAME',
  apy: 5.0,
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Address: tokenAddress,
  depositERC20Decimals: 18,
  vaultTokenAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultContractAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultRate: '2000000000000000000', // 2x
  depositFee: 0,
  withdrawFee: 0.1,
};

let beefyVaultForIDStub: SinonStub;

describe('beefy-withdraw-recipe', () => {
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

  it('Should create beefy-withdraw-recipe', async () => {
    const recipe = new BeefyWithdrawRecipe(vault.vaultID);

    const recipeInput: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18,
          amount: BigNumber.from('10000'),
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(3);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('25'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          expectedBalance: BigNumber.from('9975'),
          minBalance: BigNumber.from('9975'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Beefy Vault Withdraw',
      description: 'Withdraws from a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress,
          amount: BigNumber.from('1995'),
          recipient: 'Beefy Vault Withdraw Fee',
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('17955'),
          minBalance: BigNumber.from('17955'),
          tokenAddress,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [
        {
          data: '0x853828b6',
          to: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigNumber.from('9975'),
          tokenAddress: vault.vaultTokenAddress,
          recipient: 'VAULT_NAME Vault',
          decimals: 18,
        },
      ],
      spentNFTs: [],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigNumber.from('44'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress,
          decimals: 18,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigNumber.from('17911'),
          minBalance: BigNumber.from('17911'),
          tokenAddress,
          isBaseToken: undefined,
          decimals: 18,
        },
      ],
      outputNFTs: [],
      populatedTransactions: [],
      spentERC20Amounts: [],
      spentNFTs: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [vault.vaultTokenAddress, tokenAddress].map(tokenAddress =>
        tokenAddress.toLowerCase(),
      ),
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
        amount: BigNumber.from('25'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: vault.vaultTokenAddress,
        decimals: 18,
      },
      {
        amount: BigNumber.from('1995'),
        recipient: 'Beefy Vault Withdraw Fee',
        tokenAddress,
        decimals: 18,
      },
      {
        amount: BigNumber.from('44'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress,
        decimals: 18,
      },
    ]);
  });

  it('Should test beefy-withdraw-recipe error cases', async () => {
    const recipe = new BeefyWithdrawRecipe(vault.vaultID);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: networkName,
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
      'Beefy Vault Withdraw step is invalid. No step inputs match filter.',
    );
  });
});
