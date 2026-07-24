import chai from 'chai';
import { NetworkName } from '@railgun-community/shared-models';
import { ComboMeal } from '../combo-meal';
import { Recipe } from '../../recipes';
import { Step } from '../../steps/step';
import {
  ComboMealConfig,
  RecipeConfig,
  RecipeInput,
  RecipeOutput,
} from '../../models/export-models';

const { expect } = chai;

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const RECIPIENT = '0x1111111111111111111111111111111111111111';

/** A Recipe stub that returns a canned output and records the input it got. */
class CapturingRecipe extends Recipe {
  readonly config: RecipeConfig = {
    name: 'capture',
    description: '',
    minGasLimit: 0n,
  };

  receivedInput?: RecipeInput;
  private readonly cannedOutput: RecipeOutput;

  constructor(cannedOutput: RecipeOutput) {
    super();
    this.cannedOutput = cannedOutput;
  }

  protected supportsNetwork(): boolean {
    return true;
  }

  protected async getInternalSteps(): Promise<Step[]> {
    return [];
  }

  async getRecipeOutput(input: RecipeInput): Promise<RecipeOutput> {
    this.receivedInput = input;
    return this.cannedOutput;
  }
}

class TestComboMeal extends ComboMeal {
  readonly config: ComboMealConfig = {
    name: 'test',
    description: '',
    minGasLimit: 0n,
  };

  private readonly recipes: Recipe[];
  private readonly conservative: boolean;

  constructor(recipes: Recipe[], conservative: boolean) {
    super();
    this.recipes = recipes;
    this.conservative = conservative;
  }

  protected async getRecipes(): Promise<Recipe[]> {
    return this.recipes;
  }

  protected conservativeSeamAmounts(): boolean {
    return this.conservative;
  }
}

const emptyOutput = (name: string): RecipeOutput => ({
  name,
  stepOutputs: [],
  crossContractCalls: [],
  erc20AmountRecipients: [],
  nftRecipients: [],
  feeERC20AmountRecipients: [],
  minGasLimit: 0n,
});

const upstreamOutput = (minBalance?: bigint): RecipeOutput => ({
  ...emptyOutput('upstream'),
  erc20AmountRecipients: [
    {
      tokenAddress: TOKEN,
      decimals: 18n,
      amount: 1000n, // expectedBalance (optimistic)
      minBalance, // worst-case, when carried
      recipient: RECIPIENT,
    },
  ],
});

const comboInput = (): RecipeInput => ({
  networkName: NetworkName.Ethereum,
  railgunAddress: '0zktest',
  erc20Amounts: [],
  nfts: [],
});

const runSeam = async (
  conservative: boolean,
  minBalance?: bigint,
): Promise<RecipeInput> => {
  const downstream = new CapturingRecipe(emptyOutput('downstream'));
  const combo = new TestComboMeal(
    [new CapturingRecipe(upstreamOutput(minBalance)), downstream],
    conservative,
  );
  await combo.getComboMealOutput(comboInput());
  if (!downstream.receivedInput) {
    throw new Error('downstream recipe never ran');
  }
  return downstream.receivedInput;
};

describe('combo-meal seam', () => {
  it('Should feed the optimistic expected amount by default', async () => {
    const seam = await runSeam(false, 900n);
    expect(seam.erc20Amounts).to.have.length(1);
    expect(seam.erc20Amounts[0].amount).to.equal(1000n);
  });

  it('Should feed the worst-case minBalance when conservative', async () => {
    const seam = await runSeam(true, 900n);
    expect(seam.erc20Amounts).to.have.length(1);
    expect(seam.erc20Amounts[0].amount).to.equal(900n);
  });

  it('Should fall back to the expected amount when no minBalance is carried', async () => {
    const seam = await runSeam(true, undefined);
    expect(seam.erc20Amounts[0].amount).to.equal(1000n);
  });
});
