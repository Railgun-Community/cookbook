import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber } from 'ethers';
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

describe('beefy-deposit-step', () => {
  it('Should create beefy-deposit step', async () => {
    const step = new BeefyDepositStep(vault);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // Approved for swapping
          tokenAddress,
          expectedBalance: BigNumber.from('10000'),
          minBalance: BigNumber.from('10000'),
          approvedSpender: vault.vaultContractAddress,
        },
        {
          // Same token, unapproved
          tokenAddress,
          expectedBalance: BigNumber.from('2000'),
          minBalance: BigNumber.from('2000'),
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
        amount: BigNumber.from('9000'),
        recipient: 'VAULT_NAME Vault',
        tokenAddress,
      },
    ]);

    // Received
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        expectedBalance: BigNumber.from('4500'),
        minBalance: BigNumber.from('4500'),
        tokenAddress: vault.vaultTokenAddress,
      },
      {
        approvedSpender: undefined,
        expectedBalance: BigNumber.from('2000'),
        minBalance: BigNumber.from('2000'),
        tokenAddress,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        tokenAddress,
        amount: BigNumber.from('1000'),
        recipient: 'VAULT_NAME Vault Deposit Fee',
      },
    ]);

    expect(output.populatedTransactions).to.deep.equal([
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
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: vault.vaultContractAddress,
        },
      ],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Beefy Vault Deposit step failed. No erc20 inputs match filter.',
    );
    const stepInputNoSpender: StepInput = {
      networkName,
      erc20Amounts: [
        {
          // No spender
          tokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputNoSpender),
    ).to.be.rejectedWith(
      'Beefy Vault Deposit step failed. No erc20 inputs match filter.',
    );
  });
});
