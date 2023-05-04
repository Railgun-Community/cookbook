import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ApproveERC20SpenderStep } from '../approve-erc20-spender-step';
import { BigNumber } from 'ethers';
import { StepInput } from '../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenInfo = {
  tokenAddress: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
};
const spender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = BigNumber.from('10000');

describe('approve-erc20-spender-step', () => {
  it('Should create approve-erc20-spender step with amount', async () => {
    const approveStep = new ApproveERC20SpenderStep(spender, tokenInfo, amount);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.deep.equal([]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: spender,
        expectedBalance: BigNumber.from('10000'),
        minBalance: BigNumber.from('10000'),
      },
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: undefined,
        expectedBalance: BigNumber.from('2000'),
        minBalance: BigNumber.from('2000'),
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000002710',
        to: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
      },
    ]);
    expect(output.populatedTransactions[0].to).to.equal(tokenInfo.tokenAddress);
  });

  it('Should create approve-erc20-spender step without amount', async () => {
    const approveStep = new ApproveERC20SpenderStep(spender, tokenInfo);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.deep.equal([]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: spender,
        expectedBalance: BigNumber.from('12000'),
        minBalance: BigNumber.from('12000'),
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000002ee0',
        to: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
      },
    ]);
  });

  it('Should create empty approve-erc20-spender step without spender', async () => {
    const approveStep = new ApproveERC20SpenderStep(undefined, tokenInfo);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          expectedBalance: BigNumber.from('12000'),
          minBalance: BigNumber.from('12000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.deep.equal([]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        expectedBalance: BigNumber.from('12000'),
        minBalance: BigNumber.from('12000'),
        approvedSpender: undefined,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([]);

    expect(output.populatedTransactions).to.deep.equal([]);
  });

  it('Should test approve-erc20-spender step error cases', async () => {
    const approveStep = new ApproveERC20SpenderStep(spender, tokenInfo, amount);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [],
      nfts: [],
    };
    await expect(
      approveStep.getValidStepOutput(stepInputNoERC20s),
    ).to.be.rejectedWith(
      'Approve ERC20 Spender step failed. No erc20 inputs match filter.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          expectedBalance: BigNumber.from('2000'),
          minBalance: BigNumber.from('2000'),
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      approveStep.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      'Approve ERC20 Spender step failed. Specified amount 10000 exceeds balance 2000.',
    );
  });
});
