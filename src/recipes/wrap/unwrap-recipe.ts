import { UnwrapBaseTokenStep } from '../../steps/wrap/unwrap-base-token-step';
import { Recipe } from '../recipe';

export class UnwrapBaseTokenRecipe extends Recipe {
  readonly name = 'Unwrap Base Token';
  readonly description = 'Unwrap wrapped base token into base token.';

  constructor() {
    super();

    this.addStep(new UnwrapBaseTokenStep());
  }
}
