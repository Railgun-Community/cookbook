import { NetworkName } from '@railgun-community/shared-models';
import { RecipeConfig } from '../models/export-models';
import { Step } from '../steps/step';
import { Recipe } from './recipe';

export class CustomRecipe extends Recipe {
  readonly config: RecipeConfig;

  private readonly supportedNetworks: NetworkName[] = [];

  private internalSteps: Step[] = [];

  constructor(config: RecipeConfig, supportedNetworks: NetworkName[]) {
    super();
    this.config = config;
    this.supportedNetworks = supportedNetworks;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return this.internalSteps;
  }

  protected supportsNetwork(networkName: NetworkName): boolean {
    return this.supportedNetworks.includes(networkName);
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
