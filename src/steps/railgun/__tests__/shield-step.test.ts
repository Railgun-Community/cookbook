import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ShieldStep } from '../shield-step';
import { BigNumber } from 'ethers';
import { StepInput } from '../../../models/export-models';
import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { initCookbook } from '../../../init';

chai.use(chaiAsPromised);
const { expect } = chai;

const tokenAddress =
  NETWORK_CONFIG[NetworkName.Ethereum].baseToken.wrappedAddress;

describe('shield-step', () => {
  before(() => {
    initCookbook('25', '25');
  });

  it('Should create shield step with amount', async () => {
    const step = new ShieldStep();

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

    expect(output.name).to.equal('Shield');
    expect(output.description).to.equal(
      'Shield ERC20s and NFTs into private RAILGUN balance.',
    );

    expect(output.spentERC20Amounts).to.deep.equal([]);

    expect(output.outputERC20Amounts).to.deep.equal([
      {
        tokenAddress,
        isBaseToken: false,
        expectedBalance: BigNumber.from('11970'),
        minBalance: BigNumber.from('11970'),
        approvedSpender: undefined,
      },
    ]);

    expect(output.spentNFTs).to.deep.equal([]);
    expect(output.outputNFTs).to.deep.equal([]);

    expect(output.feeERC20AmountRecipients).to.deep.equal([
      {
        tokenAddress,
        amount: BigNumber.from('30'),
        recipient: 'RAILGUN Shield Fee',
      },
    ]);

    expect(output.populatedTransactions).to.deep.equal([]);
  });

  it('Should test shield step error cases', async () => {
    const step = new ShieldStep();

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
      'Shield step failed. Cannot shield base token.',
    );
  });
});
