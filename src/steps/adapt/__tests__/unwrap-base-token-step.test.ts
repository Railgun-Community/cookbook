import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnwrapBaseTokenStep } from '../unwrap-base-token-step';

import { StepInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const amount = 10000n;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('unwrap-base-token-step', () => {
  it('Should create unwrap-base-token step with amount', async () => {
    const step = new UnwrapBaseTokenStep(amount);

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
          expectedBalance: 12000n,
          minBalance: 12000n,
          approvedSpender: undefined,
        },
      ],
      nfts: [],
    };
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Unwrap Base Token');
    expect(output.description).to.equal(
      'Unwraps wrapped token into base token, ie WETH to ETH.',
    );

    // Transferred
    expect(output.spentERC20Amounts).to.deep.equal([
      {
        amount,
        isBaseToken: false,
        recipient: 'Wrapped Token Contract',
        tokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        // Wrapped - ETH
        approvedSpender: undefined,
        isBaseToken: true,
        expectedBalance: amount,
        minBalance: amount,
        tokenAddress,
        decimals: 18n,
      },
      {
        // Change - WETH
        approvedSpender: undefined,
        isBaseToken: false,
        expectedBalance: 2000n,
        minBalance: 2000n,
        tokenAddress,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xd5774a280000000000000000000000000000000000000000000000000000000000002710',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
    expect(output.crossContractCalls[0].to).to.equal(
      NETWORK_CONFIG[networkName].relayAdaptContract,
    );
  });

  it('Should create unwrap-base-token step without amount', async () => {
    const step = new UnwrapBaseTokenStep();

    const stepInput: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
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
        isBaseToken: false,
        recipient: 'Wrapped Token Contract',
        tokenAddress,
        decimals: 18n,
      },
    ]);

    // Wrapped
    expect(output.outputERC20Amounts).to.deep.equal([
      {
        expectedBalance: 12000n,
        minBalance: 12000n,
        isBaseToken: true,
        tokenAddress,
        approvedSpender: undefined,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.equal(undefined);

    expect(output.crossContractCalls).to.deep.equal([
      {
        data: '0xd5774a280000000000000000000000000000000000000000000000000000000000000000',
        to: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
      },
    ]);
  });

  it('Should test unwrap-base-token step error cases', async () => {
    const step = new UnwrapBaseTokenStep(amount);

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName,
      erc20Amounts: [
        {
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
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Unwrap Base Token step is invalid. No step inputs match filter.',
    );

    // Too low balance for erc20 input
    const stepInputLowBalance: StepInput = {
      networkName,
      erc20Amounts: [
        {
          tokenAddress,
          decimals: 18n,
          isBaseToken: false,
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
      'Unwrap Base Token step is invalid. Specified amount 10000 exceeds balance 2000.',
    );
  });
});
