import { RecipeConfig } from '../models/export-models';
import { Step } from '../steps/step';
import { Recipe } from './recipe';

export class CustomRecipe extends Recipe {
  readonly config: RecipeConfig;

  private internalSteps: Step[] = [];

  constructor(config: RecipeConfig) {
    super();
    this.config = config;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return this.internalSteps;
  }

  addStep(step: Step): void {
    if (!step.canAddStep) {
      throw new Error(`Cannot add Recipe Step: ${step.config.name}`);
    }

    this.internalSteps.push(step);
  }

  addSteps(steps: Step[]): void {
    steps.forEach(this.addStep);
  }
}
