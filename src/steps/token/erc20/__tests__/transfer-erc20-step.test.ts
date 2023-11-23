import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TransferERC20Step } from '../transfer-erc20-step';

import { RecipeERC20Info, StepInput } from '../../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const erc20Info: RecipeERC20Info = {
  tokenAddress: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
  decimals: 18n,
};
const amount = 10000n;

describe('transfer-erc20-step', () => {
  it('Should create transfer-erc20 step with amount', async () => {
    const step = new TransferERC20Step(toAddress, erc20Info, amount);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: erc20Info.tokenAddress,
          decimals: erc20Info.decimals,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Transfer ERC20');
    expect(output.description).to.equal(
      'Transfers ERC20 token to an external public address.',
    );

    // Transferred
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        recipient: toAddress,
        tokenAddress: erc20Info.tokenAddress,
        decimals: 18n,
      },
    ]);

    // Change
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        approvedSpender: undefined,
        expectedBalance: 2000n,
        minBalance: 2000n,
        tokenAddress: erc20Info.tokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xc2e9ffd8000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e76c6c83af64e4c60245d8c7de953df673a7a33d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000002710',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
  });

  it('Should create transfer-erc20 step without amount', async () => {
    const step = new TransferERC20Step(toAddress, erc20Info);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: erc20Info.tokenAddress,
          decimals: erc20Info.decimals,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    // Transferred
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount: 12000n,
        recipient: toAddress,
        tokenAddress: erc20Info.tokenAddress,
        decimals: 18n,
      },
    ]);

    // Change
    expect(output.outputERC20Amounts).to.deep.equal([]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xc2e9ffd8000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e76c6c83af64e4c60245d8c7de953df673a7a33d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
  });

  it('Should test transfer-erc20 step error cases', async () => {
    const step = new TransferERC20Step(toAddress, erc20Info, amount);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [],
      nfts: [],
    };
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Transfer ERC20 step is invalid.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: erc20Info.tokenAddress,
          decimals: erc20Info.decimals,
          expectedBalance: 2000n,
          minBalance: 2000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      step.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      'Transfer ERC20 step is invalid.',
    );
  });
});
