import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName } from '@railgun-community/shared-models';
import { StepInput } from '../../../../models/export-models';
import { BeefyVaultData } from '../../../../api/beefy/beefy-api';
import { BeefyDepositStep } from '../beefy-deposit-step';

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
  depositFeeBasisPoints: 1000n,
  withdrawFeeBasisPoints: 0n,
};

describe('beefy-deposit-step', () => {
  it('Should create beefy-deposit step', async () => {
    const step = new BeefyDepositStep(vault);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Approved for swapping
          tokenAddress,
          decimals: 18n,
          expectedBalance: 10000n,
          minBalance: 10000n,
          approvedSpender: vault.vaultContractAddress,
        },
        {
          // Same token, unapproved
          tokenAddress,
          decimals: 18n,
          expectedBalance: 2000n,
          minBalance: 2000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Beefy Vault Deposit');
    expect(output.description).to.equal(
      'Deposits into a yield-bearing Beefy Vault.',
    );

    // Deposited
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: BigInt('9000'),
        recipient: 'VAULT_NAME Vault',
        tokenAddress,
        decimals: 18n,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        expectedBalance: BigInt('4500'),
        minBalance: BigInt('4500'),
        tokenAddress: vault.vaultTokenAddress,
        decimals: 18n,
      },
      {
        approvedSpender: undefined,
        expectedBalance: 2000n,
        minBalance: 2000n,
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
        amount: 1000n,
        recipient: 'VAULT_NAME Vault Deposit Fee',
      },
    ]);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xde5f6268',
        to: '0x40324434a0b53dd1ED167Ba30dcB6B4bd7a9536d',
      },
    ]);
  });

  it('Should test beefy-deposit step error cases', async () => {
    const step = new BeefyDepositStep(vault);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: vault.vaultTokenAddress,
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: vault.vaultContractAddress,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Beefy Vault Deposit step is invalid. No step inputs match filter.',
    );
    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // No spender
          tokenAddress,
          decimals: 18n,
          isBaseToken: true,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      'Beefy Vault Deposit step is invalid. No step inputs match filter.',
    );
  });
});
