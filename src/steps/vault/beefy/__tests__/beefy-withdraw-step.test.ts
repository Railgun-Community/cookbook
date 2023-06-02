import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
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
  apy: 5.0,
  chain: 'ethereum',
  network: 'ethereum',
  depositERC20Address: tokenAddress,
  depositERC20Decimals: 18n,
  vaultTokenAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultContractAddress: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
  vaultRate: BigInt('2000000000000000000'), // 2x
  depositFeeBasisPoints: 0n,
  withdrawFeeBasisPoints: 1000n,
};

describe('beefy-withdraw-step', () => {
  it('Should create beefy-withdraw step', async () => {
    const step = new BeefyWithdrawStep(vault);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
          expectedBalance: 10000n,
          minBalance: 10000n,
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
        amount: 10000n,
        recipient: 'VAULT_NAME Vault',
        tokenAddress: vault.vaultTokenAddress,
        decimals: 18n,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        expectedBalance: 18000n,
        minBalance: 18000n,
        tokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        decimals: 18n,
        tokenAddress,
        amount: 2000n,
        recipient: 'Beefy Vault Withdraw Fee',
      },
    ]);

    expect(output.crossContractCalls).to.deep.equal([
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
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: vault.vaultContractAddress,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Beefy Vault Withdraw step is invalid. No step inputs match filter.',
    );
  });
});
