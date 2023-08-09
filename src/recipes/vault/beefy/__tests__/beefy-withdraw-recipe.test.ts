import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyWithdrawRecipe } from '../beefy-withdraw-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../../init';
import Sinon, { SinonStub } from 'sinon';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
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
  depositFeeBasisPoints: 0n,
  withdrawFeeBasisPoints: 1000n,
  isActive: true,
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
  depositFeeBasisPoints: 0n,
  withdrawFeeBasisPoints: 1000n,
  isActive: true,
};

let beefyVaultForIDStub: SinonStub;

describe('beefy-withdraw-recipe', () => {
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

  it('Should create beefy-withdraw-recipe (ethereum)', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      ethVault,
    );

    const recipe = new BeefyWithdrawRecipe(ethVault.vaultID);

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: ethVault.vaultERC20Address,
          decimals: 18n,
          amount: 10000n,
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(3);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield (Default)',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('25'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: ethVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: ethVault.vaultERC20Address,
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
      name: 'Beefy Vault Withdraw',
      description: 'Withdraws from a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: ethVault.depositERC20Address,
          amount: BigInt('1995'),
          recipient: 'VAULT_NAME Vault Withdraw Fee',
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('17955'),
          minBalance: BigInt('17955'),
          tokenAddress: ethVault.depositERC20Address,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x853828b6',
          to: ethVault.vaultERC20Address,
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('9975'),
          tokenAddress: ethVault.vaultERC20Address,
          recipient: 'VAULT_NAME Vault',
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Shield (Default)',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('44'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: ethVault.depositERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('17911'),
          minBalance: BigInt('17911'),
          tokenAddress: ethVault.depositERC20Address,
          isBaseToken: undefined,
          decimals: 18n,
          recipient: undefined,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20AmountRecipients.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [ethVault.vaultERC20Address, ethVault.depositERC20Address].map(
        tokenAddress => tokenAddress.toLowerCase(),
      ),
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
        amount: BigInt('25'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: ethVault.vaultERC20Address,
        decimals: 18n,
      },
      {
        amount: BigInt('1995'),
        recipient: 'VAULT_NAME Vault Withdraw Fee',
        tokenAddress: ethVault.depositERC20Address,
        decimals: 18n,
      },
      {
        amount: BigInt('44'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: ethVault.depositERC20Address,
        decimals: 18n,
      },
    ]);
  });

  it('Should create beefy-withdraw-recipe (polygon stargate)', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      polygonVault,
    );

    const recipe = new BeefyWithdrawRecipe(polygonVault.vaultID);

    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName: networkName,
      erc20Amounts: [
        {
          tokenAddress: polygonVault.vaultERC20Address,
          decimals: 18n,
          amount: 10000000000000000n, // 0.01
        },
      ],
      nfts: [],
    };
    const output = await recipe.getRecipeOutput(recipeInput);

    expect(output.stepOutputs.length).to.equal(3);

    expect(output.stepOutputs[0]).to.deep.equal({
      name: 'Unshield (Default)',
      description: 'Unshield ERC20s and NFTs from private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('25000000000000'),
          recipient: 'RAILGUN Unshield Fee',
          tokenAddress: polygonVault.vaultERC20Address,
          decimals: 18n,
        },
      ],
      outputERC20Amounts: [
        {
          tokenAddress: polygonVault.vaultERC20Address,
          expectedBalance: BigInt('9975000000000000'),
          minBalance: BigInt('9975000000000000'),
          approvedSpender: undefined,
          isBaseToken: undefined,
          decimals: 18n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(output.stepOutputs[1]).to.deep.equal({
      name: 'Beefy Vault Withdraw',
      description: 'Withdraws from a yield-bearing Beefy Vault.',
      feeERC20AmountRecipients: [
        {
          tokenAddress: polygonVault.depositERC20Address,
          amount: BigInt('1995'),
          recipient: 'USDC LP Vault Withdraw Fee',
          decimals: 6n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('17955'),
          minBalance: BigInt('17955'),
          tokenAddress: polygonVault.depositERC20Address,
          decimals: 6n,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [
        {
          data: '0x853828b6',
          to: polygonVault.vaultERC20Address,
        },
      ],
      spentERC20Amounts: [
        {
          amount: BigInt('9975000000000000'),
          tokenAddress: polygonVault.vaultERC20Address,
          recipient: 'USDC LP Vault',
          decimals: 18n,
        },
      ],
    });

    expect(output.stepOutputs[2]).to.deep.equal({
      name: 'Shield (Default)',
      description: 'Shield ERC20s and NFTs into private RAILGUN balance.',
      feeERC20AmountRecipients: [
        {
          amount: BigInt('44'),
          recipient: 'RAILGUN Shield Fee',
          tokenAddress: polygonVault.depositERC20Address,
          decimals: 6n,
        },
      ],
      outputERC20Amounts: [
        {
          approvedSpender: undefined,
          expectedBalance: BigInt('17911'),
          minBalance: BigInt('17911'),
          tokenAddress: polygonVault.depositERC20Address,
          isBaseToken: undefined,
          decimals: 6n,
          recipient: undefined,
        },
      ],
      outputNFTs: [],
      crossContractCalls: [],
    });

    expect(
      output.erc20AmountRecipients.map(({ tokenAddress }) => tokenAddress),
    ).to.deep.equal(
      [polygonVault.vaultERC20Address, polygonVault.depositERC20Address].map(
        tokenAddress => tokenAddress.toLowerCase(),
      ),
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
        amount: BigInt('25000000000000'),
        recipient: 'RAILGUN Unshield Fee',
        tokenAddress: polygonVault.vaultERC20Address,
        decimals: 18n,
      },
      {
        amount: BigInt('1995'),
        recipient: 'USDC LP Vault Withdraw Fee',
        tokenAddress: polygonVault.depositERC20Address,
        decimals: 6n,
      },
      {
        amount: BigInt('44'),
        recipient: 'RAILGUN Shield Fee',
        tokenAddress: polygonVault.depositERC20Address,
        decimals: 6n,
      },
    ]);
  });

  it('Should test beefy-withdraw-recipe error cases', async () => {
    beefyVaultForIDStub = Sinon.stub(BeefyAPI, 'getBeefyVaultForID').resolves(
      ethVault,
    );

    const recipe = new BeefyWithdrawRecipe(ethVault.vaultID);

    // No matching erc20 inputs
    const recipeInputNoMatch: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
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
      'Beefy Vault Withdraw step is invalid. No step inputs match filter.',
    );
  });
});
