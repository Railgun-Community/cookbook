import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CustomRecipe } from '../custom-recipe';
import { UnwrapBaseTokenStep } from '../../steps/adapt/unwrap-base-token-step';
import { StepInput } from '../../models/export-models';
import { NetworkName } from '@railgun-community/shared-models';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('custom-recipe', () => {
  it('Should add custom recipe steps', async () => {
    const recipe = new CustomRecipe({
      name: 'custom',
      description: 'this is a custom recipe',
    });

    recipe.addStep(new UnwrapBaseTokenStep());

    const firstStepInput: StepInput = {
      networkName: NetworkName.Ethereum,
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
