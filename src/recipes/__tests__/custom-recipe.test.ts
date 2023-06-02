import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CustomRecipe } from '../custom-recipe';
import { UnwrapBaseTokenStep } from '../../steps/adapt/unwrap-base-token-step';
import { StepInput } from '../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';
import { setRailgunFees } from '../../init';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

describe('custom-recipe', () => {
  before(() => {
    setRailgunFees(networkName, 25n, 25n);
  });

  it('Should add custom recipe steps', async () => {
    const supportedNetworks = [networkName];

    const recipe = new CustomRecipe(
      {
        name: 'custom',
        description: 'this is a custom recipe',
      },
      supportedNetworks,
    );

    recipe.addStep(new UnwrapBaseTokenStep());

    const firstStepInput: StepInput = {
      networkName,
      erc20Amounts: [],
      nfts: [],
    };

    // @ts-expect-error
    const steps = await recipe.getFullSteps(firstStepInput);

    expect(steps.map(step => step.config.name)).to.deep.equal([
      'Unshield',
      'Unwrap Base Token',
      'Shield',
    ]);
  });
});
