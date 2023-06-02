import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ApproveERC20SpenderStep } from '../approve-erc20-spender-step';

import { RecipeERC20Info, StepInput } from '../../../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenInfo: RecipeERC20Info = {
  tokenAddress: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
  decimals: 18n,
};
const spender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const amount = 10000n;
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';

describe('approve-erc20-spender-step', () => {
  it('Should create approve-erc20-spender step with amount', async () => {
    const approveStep = new ApproveERC20SpenderStep(spender, tokenInfo, amount);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.equal(undefined);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: spender,
        expectedBalance: 10000n,
        minBalance: 10000n,
        isBaseToken: undefined,
        decimals: 18n,
      },
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: undefined,
        expectedBalance: 2000n,
        minBalance: 2000n,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000002710',
        to: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
      },
    ]);
    expect(output.crossContractCalls[0].to).to.equal(tokenInfo.tokenAddress);
  });

  it('Should create approve-erc20-spender step without amount', async () => {
    const approveStep = new ApproveERC20SpenderStep(spender, tokenInfo);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.equal(undefined);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        approvedSpender: spender,
        expectedBalance: 12000n,
        minBalance: 12000n,
        isBaseToken: undefined,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        to: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
      },
    ]);
  });

  it('Should create approve-erc20-spender step for USDT', async () => {
    const usdtTokenInfo: RecipeERC20Info = {
      tokenAddress: USDT_ADDRESS,
      decimals: 6n,
    };

    const approveStep = new ApproveERC20SpenderStep(spender, usdtTokenInfo);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: USDT_ADDRESS,
          decimals: 6n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.equal(undefined);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: USDT_ADDRESS,
        approvedSpender: spender,
        expectedBalance: 12000n,
        minBalance: 12000n,
        isBaseToken: undefined,
        decimals: 6n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000000000000000',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
      {
        data: '0x095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
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
          decimals: 18n,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await approveStep.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Approve ERC20 Spender');
    expect(output.description).to.equal('Approves ERC20 for spender contract.');

    expect(output.spentERC20Amounts).to.equal(undefined);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress: tokenInfo.tokenAddress,
        expectedBalance: 12000n,
        minBalance: 12000n,
        approvedSpender: undefined,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([]);
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
      'Approve ERC20 Spender step is invalid. No step inputs match filter.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress: tokenInfo.tokenAddress,
          decimals: 18n,
          expectedBalance: 2000n,
          minBalance: 2000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    await expect(
      approveStep.getValidStepOutput(stepInputLowBalance),
    ).to.be.rejectedWith(
      'Approve ERC20 Spender step is invalid. Specified amount 10000 exceeds balance 2000.',
    );
  });
});
