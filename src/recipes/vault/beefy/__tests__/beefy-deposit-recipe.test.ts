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

const ethVault: BeefyVaultData = {
  vaultID: 'id',
  vaultName: 'VAULT_NAME',
  apy: 5.0,
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Symbol: 'RAIL',
  depositERC20Address: testConfig.contractsEthereum.rail.toLowerCase(),
  depositERC20Decimals: 18n,
  vaultERC20Symbol: 'mooHermesMETIS-m.USDC',
  vaultERC20Address: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultContractAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultRate: BigInt('2000000000000000000'), // 2x
  depositFeeBasisPoints: 1000n,
  withdrawFeeBasisPoints: 0n,
};

const polygonVault: BeefyVaultData = {
  vaultID: 'stargate-polygon-usdc',
  vaultName: 'USDC LP',
  apy: 0.042,
  chain: 'polygon',
  network: 'polygon',
  depositERC20Symbol: 'S*USDC',
  depositERC20Address:
    '0x1205f31718499dBf1fCa446663B532Ef87481fe1'.toLowerCase(),
  depositERC20Decimals: 6n,
  vaultERC20Symbol: 'mooStargateUSDC',
  vaultERC20Address: '0x2F4BBA9fC4F77F16829F84181eB7C8b50F639F95',
  vaultContractAddress: '0x2F4BBA9fC4F77F16829F84181eB7C8b50F639F95',
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
  });

  afterEach(() => {
    beefyVaultForIDStub.restore();
  });

  it('Should create beefy-deposit-recipe (ethereum)', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      ethVault,
    );

    const recipe = new BeefyDepositRecipe(ethVault.vaultID);

    const recipeInput: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: ethVault.depositERC20Address,
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
          tokenAddress: ethVault.depositERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: ethVault.depositERC20Address,
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
          approvedSpender: ethVault.vaultContractAddress,
          expectedBalance: BigInt('9975'),
          minBalance: BigInt('9975'),
          isBaseToken: undefined,
          tokenAddress: ethVault.depositERC20Address,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b300000000000000000000000040324434a0b53dd1ed167ba30dcb6b4bd7a9536dffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: ethVault.depositERC20Address,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: ethVault.depositERC20Address,
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
          tokenAddress: ethVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xde5f6268',
          to: ethVault.vaultERC20Address,
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('8978'),
          tokenAddress: ethVault.depositERC20Address,
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
          tokenAddress: ethVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('4478'),
          minBalance: BigInt('4478'),
          tokenAddress: ethVault.vaultERC20Address,
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
      [ethVault.depositERC20Address, ethVault.vaultERC20Address].map(
        tokenAddress => tokenAddress.toLowerCase(),
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
        tokenAddress: ethVault.depositERC20Address,
        decimals: 18n,
      },
      {
        amount: BigInt('997'),
        recipient: 'VAULT_NAME Vault Deposit Fee',
        tokenAddress: ethVault.depositERC20Address,
        decimals: 18n,
      },
      {
        amount: BigInt('11'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: ethVault.vaultERC20Address,
        decimals: 18n,
      },
    ]);
  });

  it('Should create beefy-deposit-recipe (polygon stargate)', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      polygonVault,
    );

    const recipe = new BeefyDepositRecipe(polygonVault.vaultID);

    const recipeInput: RecipeInput = {
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: polygonVault.depositERC20Address,
          decimals: 6n,
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
          tokenAddress: polygonVault.depositERC20Address,
          decimals: 6n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: polygonVault.depositERC20Address,
          expectedBalance: BigInt('9975'),
          minBalance: BigInt('9975'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          decimals: 6n,
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
          approvedSpender: polygonVault.vaultContractAddress,
          expectedBalance: BigInt('9975'),
          minBalance: BigInt('9975'),
          isBaseToken: undefined,
          tokenAddress: polygonVault.depositERC20Address,
          decimals: 6n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x095ea7b30000000000000000000000002f4bba9fc4f77f16829f84181eb7c8b50f639f95ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          to: polygonVault.depositERC20Address,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Beefy Vault Deposit',
      description: 'Deposits into a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: polygonVault.depositERC20Address,
          amount: BigInt('997'),
          recipient: 'USDC LP Vault Deposit Fee',
          decimals: 6n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('4489000000000000'),
          minBalance: BigInt('4489000000000000'),
          tokenAddress: polygonVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0xde5f6268',
          to: polygonVault.vaultERC20Address,
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('8978'),
          tokenAddress: polygonVault.depositERC20Address,
          recipient: 'USDC LP Vault',
          decimals: 6n,
        },
      ],
    });

    expect(output.stepOutputs[3]).to.deep.equal({
      name: 'Shield',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('11222500000000'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: polygonVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('4477777500000000'),
          minBalance: BigInt('4477777500000000'),
          tokenAddress: polygonVault.vaultERC20Address,
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
      [polygonVault.depositERC20Address, polygonVault.vaultERC20Address].map(
        tokenAddress => tokenAddress.toLowerCase(),
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
        tokenAddress: polygonVault.depositERC20Address,
        decimals: 6n,
      },
      {
        amount: BigInt('997'),
        recipient: 'USDC LP Vault Deposit Fee',
        tokenAddress: polygonVault.depositERC20Address,
        decimals: 6n,
      },
      {
        amount: BigInt('11222500000000'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: polygonVault.vaultERC20Address,
        decimals: 18n,
      },
    ]);
  });

  it('Should test beefy-deposit-recipe error cases', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      ethVault,
    );

    const recipe = new BeefyDepositRecipe(ethVault.vaultID);

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
