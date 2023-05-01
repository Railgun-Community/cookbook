import { Step } from '../steps/step';
import { Recipe } from './recipe';

export class CustomRecipe extends Recipe {
  readonly name: string;
  readonly description: string;

  private internalSteps: Step[] = [];

  constructor(name: string, description: string) {
    super();

    this.name = name;
    this.description = description;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return this.internalSteps;
  }

  addStep(step: Step): void {
    if (!step.canAddStep) {
      throw new Error(`Cannot add Recipe Step: ${step.name}`);
    }

    this.internalSteps.push(step);
  }

  addSteps(steps: Step[]): void {
    steps.forEach(this.addStep);
  }
}
