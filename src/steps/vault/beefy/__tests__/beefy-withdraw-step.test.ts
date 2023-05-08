import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../../models/export-models';
import { BeefyVaultData } from '../../../../api/beefy/beefy-api';
import { BeefyWithdrawStep } from '../beefy-withdraw-step';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const tokenAddress = '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D';

const vault: BeefyVaultData = {
  vaultID: 'id',
  vaultName: 'VAULT_NAME',
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

describe('beefy-withdraw-step', () => {
  it('Should create beefy-withdraw step', async () => {
    const step = new BeefyWithdrawStep(vault);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18,
          expectedBalance: BigNumber.from('10000'),
          minBalance: BigNumber.from('10000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Beefy Vault Withdraw');
    expect(output.description).to.equal(
      'Withdraws from a yield-bearing Beefy Vault.',
    );

    // Withdrawn
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: BigNumber.from('10000'),
        recipient: 'VAULT_NAME Vault',
        tokenAddress: vault.vaultTokenAddress,
        decimals: 18,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        expectedBalance: BigNumber.from('18000'),
        minBalance: BigNumber.from('18000'),
        tokenAddress,
        decimals: 18,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        decimals: 18,
        tokenAddress,
        amount: BigNumber.from('2000'),
        recipient: 'Beefy Vault Withdraw Fee',
      },
    ]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0x853828b6',
        to: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
      },
    ]);
  });

  it('Should test beefy-withdraw step error cases', async () => {
    const step = new BeefyWithdrawStep(vault);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: vault.vaultContractAddress,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Beefy Vault Withdraw step failed. No erc20 inputs match filter.',
    );
  });
});
