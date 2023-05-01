import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TransferBaseTokenStep } from '../transfer-base-token-step';
import { BigNumber } from 'ethers';
import { StepInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');
const tokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

describe('transfer-base-token-step', () => {
  it('Should create transfer-base-token step with amount', async () => {
    const transferStep = new TransferBaseTokenStep(toAddress, amount);

    const stepInput: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await transferStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Transfer Base Token');
    expect(output.description).to.equal(
      'Transfers base token to an external public address.',
    );

    // Transferred
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: true,
        recipient: toAddress,
        tokenAddress,
      },
    ]);

    // Change
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: BigNumber.from('2000'),
        minBalance: BigNumber.from('2000'),
        tokenAddress,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0xc2e9ffd800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000002710',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
    expect(output.populatedTransactions[0].to).to.equal(
      NETWORK_CONFIG[NetworkName.Ethereum].relayAdaptContract,
    );
  });

  it('Should create transfer-base-token step without amount', async () => {
    const transferStep = new TransferBaseTokenStep(toAddress);

    const stepInput: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await transferStep.getValidStepOutput(stepInput);

    // Transferred
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: BigNumber.from('12000'),
        isBaseToken: true,
        recipient: toAddress,
        tokenAddress,
      },
    ]);

    // Change
    expect(output.outputERC20Amounts).to.deep.equal([]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0xc2e9ffd800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
  });

  it('Should test transfer-base-token step error cases', async () => {
    const transferStep = new TransferBaseTokenStep(toAddress, amount);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress,
          isBaseToken: false,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      transferStep.getValidStepOutput(stepInputNoERC20s),
    ).to.be.rejectedWith(
      'Transfer Base Token step failed. No erc20 inputs match step filter.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName: NetworkName.Ethereum,
      erc20Amounts: [
        {
          tokenAddress,
          isBaseToken: true,
          expectedBalance: BigNumber.from('2000'),
          minBalance: BigNumber.from('2000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      transferStep.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      'Transfer Base Token step failed. Specified amount 10000 exceeds balance 2000.',
    );
  });
});
