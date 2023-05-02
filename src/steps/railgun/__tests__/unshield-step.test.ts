import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnshieldStep } from '../unshield-step';
import { BigNumber } from 'ethers';
import { StepInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const tokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

describe('unshield-step', () => {
  before(() => {
    initCookbook(MOCK_SHIELD_FEE_BASIS_POINTS, MOCK_UNSHIELD_FEE_BASIS_POINTS);
  });

  it('Should create unshield step', async () => {
    const step = new UnshieldStep();

    const stepInput: StepInput = {
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
    const output = await step.getValidStepOutput(stepInput);

    expect(output.name).to.equal('Unshield');
    expect(output.description).to.equal(
      'Unshield ERC20s and NFTs from private RAILGUN balance.',
    );

    expect(output.spentERC20Amounts).to.deep.equal([]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress,
        expectedBalance: BigNumber.from('11970'),
        minBalance: BigNumber.from('11970'),
        approvedSpender: undefined,
        isBaseToken: false,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        tokenAddress,
        amount: BigNumber.from('30'),
        recipient: 'RAILGUN Unshield Fee',
      },
    ]);

    expect(output.populatedTransactions).to.deep.equal([]);
  });

  it('Should test unshield step error cases', async () => {
    const step = new UnshieldStep();

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
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
    await expect(step.getValidStepOutput(stepInputNoERC20s)).to.be.rejectedWith(
      'Unshield step failed. Cannot unshield base token.',
    );
  });
});
