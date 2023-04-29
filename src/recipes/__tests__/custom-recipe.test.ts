import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CustomRecipe } from '../custom-recipe';
import { UnwrapBaseTokenStep } from '../../steps/wrap/unwrap-base-token-step';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('recipe', () => {
  it('Should add custom recipe steps', () => {
    const recipe = new CustomRecipe('custom', 'this is a custom recipe');

    recipe.addStep(new UnwrapBaseTokenStep());

    expect(recipe.getFullSteps().map(step => step.name)).to.deep.equal([
      'Unshield',
      'Unwrap Base Token',
      'Shield',
    ]);
  });
});
