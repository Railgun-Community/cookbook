import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyDepositRecipe } from '../beefy-deposit-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import { BeefyAPI, BeefyVaultData } from '../../../../api/beefy/beefy-api';
import { testConfig } from '../../../../test/test-config.test';

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
  depositERC20Decimals: 18n,
  vaultTokenAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultContractAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultRate: BigInt('2000000000000000000'), // 2x
  depositFeeBasisPoints: 1000n,
  withdrawFeeBasisPoints: 0n,
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

  it('Should create beefy-deposit-recipe', async () => {
    const recipe = new BeefyDepositRecipe(vault.vaultID);

    const recipeInput: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          amount: 10000n,
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
          amount: BigInt('25'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress,
          expectedBalance: BigInt('9975'),
          minBalance: BigInt('9975'),
          approvedSpender: undefined,
          isBaseToken: undefined,
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
          approvedSpender: vault.vaultContractAddress,
          expectedBalance: BigInt('9975'),
          minBalance: BigInt('9975'),
          isBaseToken: undefined,
          tokenAddress,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b300000000000000000000000040324434a0b53dd1ed167ba30dcb6b4bd7a9536dffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: '0xe76c6c83af64e4c60245d8c7de953df673a7a33d',
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress,
          amount: BigInt('997'),
          recipient: 'VAULT_NAME Vault Deposit Fee',
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('4489'),
          minBalance: BigInt('4489'),
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xde5f6268',
          to: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('8978'),
          tokenAddress,
          recipient: 'VAULT_NAME Vault',
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('11'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('4478'),
          minBalance: BigInt('4478'),
          tokenAddress: vault.vaultTokenAddress,
          isBaseToken: undefined,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20Amounts.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [tokenAddress, vault.vaultTokenAddress].map(tokenAddress =>
        tokenAddress.toLowerCase(),
      ),
    );

    expect(output.nfts).to.deep.equal([]);

    const crossContractCallsFlattened = output.stepOutputs.flatMap(
      stepOutput => stepOutput.crossContractCalls,
    );
    expect(output.crossContractCalls).to.deep.equal(
      crossContractCallsFlattened,
    );

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        amount: BigInt('25'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress,
        decimals: 18n,
      },
      {
        amount: BigInt('997'),
        recipient: 'VAULT_NAME Vault Deposit Fee',
        tokenAddress,
        decimals: 18n,
      },
      {
        amount: BigInt('11'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: vault.vaultTokenAddress,
        decimals: 18n,
      },
    ]);
  });

  it('Should test beefy-deposit-recipe error cases', async () => {
    const recipe = new BeefyDepositRecipe(vault.vaultID);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: '0x1234',
          decimals: 18n,
          amount: 12000n,
        },
      ],
      nfts: [],
    };
    await expect(recipe.getRecipeOutput(recipeInputNoMatch)).to.be.rejectedWith(
      'Approve ERC20 Spender step is invalid. No step inputs match filter.',
    );
  });
});
