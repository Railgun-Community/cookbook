import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnshieldStep } from '../unshield-step';

import { StepInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../../init';
import {
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const tokenAddress = NETWORK_CONFIG[networkName].baseToken.wrappedAddress;

describe('unshield-step', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should create unshield step', async () => {
    const step = new UnshieldStep();

    const stepInput: StepInput = {
      networkName: networkName,
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

    expect(output.name).to.equal('Unshield');
    expect(output.description).to.equal(
      'Unshield ERC20s and NFTs from private RAILGUN balance.',
    );

    expect(output.spentERC20Amounts).to.equal(undefined);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress,
        expectedBalance: BigInt('11970'),
        minBalance: BigInt('11970'),
        approvedSpender: undefined,
        isBaseToken: false,
        decimals: 18n,
      },
    ]);

    expect(output.spentNFTs).to.equal(undefined);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        decimals: 18n,
        tokenAddress,
        amount: 30n,
        recipient: 'RAILGUN Unshield Fee',
      },
    ]);

    expect(output.crossContractCalls).to.deep.equal([]);
  });

  it('Should test unshield step error cases', async () => {
    const step = new UnshieldStep();

    // No matching erc20 inputs
    const stepInputNoERC20s: StepInput = {
      networkName: networkName,
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
      'Unshield step is invalid. Cannot unshield base token.',
    );
  });
});
