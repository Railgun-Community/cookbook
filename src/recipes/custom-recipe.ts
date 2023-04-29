import { Recipe } from './recipe';

export class CustomRecipe extends Recipe {
  readonly name: string;
  readonly description: string;

  constructor(name: string, description: string) {
    super();

    this.name = name;
    this.description = description;
  }
}
