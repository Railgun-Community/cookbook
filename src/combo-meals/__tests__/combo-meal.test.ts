import chai from 'chai';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import { ComboMeal } from '../combo-meal';
import { Recipe } from '../../recipes';
import { Step } from '../../steps/step';
import {
  ComboMealConfig,
  RecipeConfig,
  RecipeInput,
  RecipeNFTRecipient,
  RecipeOutput,
  RecipePositionInfo,
} from '../../models/export-models';
import { FxMintTopupRecipe } from '../../recipes/borrow/fx/fx-mint-topup-recipe';
import { resolvePool } from '../../steps/borrow/fx/fx-mint-util';
import { setRailgunFees } from '../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../test/mocks.test';

const { expect } = chai;

const TOKEN = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const RECIPIENT = '0x1111111111111111111111111111111111111111';

// Morpho Blue position fixture: an un-tokenized position keyed by an account.
const OWNER = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const MARKET_ID =
  '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9';

// f(x) position NFT shape: the pool contract is the NFT contract, and the
// steps derive tokenSubID as '0x' + positionId.toString(16).
const NFT_ADDRESS = '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8'; // pragma: allowlist secret
const TOKEN_SUB_ID = '0x76f'; // positionId 1903

const nftRecipient = (
  amount: bigint,
  overrides: Partial<RecipeNFTRecipient> = {},
): RecipeNFTRecipient => ({
  nftAddress: NFT_ADDRESS,
  tokenSubID: TOKEN_SUB_ID,
  nftTokenType: NFTTokenType.ERC721,
  amount,
  recipient: RECIPIENT,
  ...overrides,
});

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
  outputPositions: [],
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

/**
 * An NFT that transits a combo seam is emitted once per recipe: each recipe's
 * own final step re-declares it (see Recipe.getRecipeOutput —
 * `amount: isFinalStep ? outputNFT.amount : 0n`). Summing those declarations,
 * as the ERC-20 branch does, yields amount 2n for an ERC-721 — which
 * validateStepOutputNFTs rejects outright. The downstream recipe's amount is
 * the terminal state, so the correct semantic is last-writer-wins.
 */
describe('combo-meal NFT aggregation', () => {
  const runNFTSeam = async (
    upstreamNFTs: RecipeNFTRecipient[],
    downstreamNFTs: RecipeNFTRecipient[],
  ): Promise<RecipeOutput> => {
    const combo = new TestComboMeal(
      [
        new CapturingRecipe({
          ...emptyOutput('upstream'),
          nftRecipients: upstreamNFTs,
        }),
        new CapturingRecipe({
          ...emptyOutput('downstream'),
          nftRecipients: downstreamNFTs,
        }),
      ],
      false,
    );
    return combo.getComboMealOutput(comboInput());
  };

  it('Should not sum an NFT declared by both recipes', async () => {
    const output = await runNFTSeam([nftRecipient(1n)], [nftRecipient(1n)]);
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
  });

  it('Should take the downstream amount when the position is burned', async () => {
    // Full close: the NFT survives the upstream recipe but not the downstream.
    const output = await runNFTSeam([nftRecipient(1n)], [nftRecipient(0n)]);
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(0n);
  });

  it('Should pass through an NFT minted only by the downstream recipe', async () => {
    // Open: no input NFT; the position is minted by the last recipe.
    const output = await runNFTSeam([], [nftRecipient(1n)]);
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
  });

  it('Should dedupe an NFT across checksum-case and zero-padded tokenSubID', async () => {
    const output = await runNFTSeam(
      [
        nftRecipient(1n, {
          nftAddress: NFT_ADDRESS.toLowerCase(),
          tokenSubID:
            '0x000000000000000000000000000000000000000000000000000000000000076f',
        }),
      ],
      [nftRecipient(1n)],
    );
    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
  });

  it('Should carry a position NFT through a real downstream recipe', async () => {
    // The stubs above prove the aggregation rule; this proves the rule holds
    // when the downstream is a real recipe that runs the full step engine
    // (shield epilogue, step validator, NFT pass-through). Uses the WBTC-Long
    // direct path so no 0x quote and no network call is involved.
    setRailgunFees(
      NetworkName.Ethereum,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );

    const wbtcPool = resolvePool('WBTC-Long');
    const positionNFT = nftRecipient(1n, {
      nftAddress: wbtcPool.address,
      recipient: MOCK_RAILGUN_WALLET_ADDRESS,
    });

    const upstream = new CapturingRecipe({
      ...emptyOutput('upstream'),
      erc20AmountRecipients: [
        {
          tokenAddress: wbtcPool.collateralToken,
          decimals: wbtcPool.collateralDecimals,
          amount: 100_000n,
          recipient: MOCK_RAILGUN_WALLET_ADDRESS,
        },
      ],
      nftRecipients: [positionNFT],
    });

    const combo = new TestComboMeal(
      [upstream, new FxMintTopupRecipe({ pool: 'WBTC-Long', positionId: 1903n })],
      false,
    );

    const output = await combo.getComboMealOutput({
      ...comboInput(),
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
    });

    expect(output.nftRecipients).to.have.length(1);
    expect(output.nftRecipients[0].amount).to.equal(1n);
    expect(output.nftRecipients[0].recipient).to.equal(
      MOCK_RAILGUN_WALLET_ADDRESS,
    );
    expect(output.nftRecipients[0].nftAddress).to.equal(wbtcPool.address);
  });

  it('Should forward a zero-amount NFT across the seam unfiltered', async () => {
    // The erc20Amounts `> 0n` filter must not leak to NFTs: a burned-position
    // declaration still has to reach the downstream recipe's input.
    const downstream = new CapturingRecipe(emptyOutput('downstream'));
    const combo = new TestComboMeal(
      [
        new CapturingRecipe({
          ...emptyOutput('upstream'),
          nftRecipients: [nftRecipient(0n)],
        }),
        downstream,
      ],
      false,
    );
    await combo.getComboMealOutput(comboInput());
    expect(downstream.receivedInput?.nfts).to.have.length(1);
    expect(downstream.receivedInput?.nfts[0].amount).to.equal(0n);
  });
});

/**
 * Positions aggregate the OPPOSITE way to NFTs, for the same underlying reason.
 *
 * An NFT is a balance: it transits the seam and every recipe it passes through
 * re-declares it, so the declarations must be reconciled (last writer wins). A
 * position record is an event: nothing carries positions across the seam —
 * `createNextRecipeInput` builds the next RecipeInput from `erc20AmountRecipients`
 * and `nftRecipients` only — and a step emits one only when it itself changes a
 * position. Two records for the same market and leg therefore describe two real
 * changes, and collapsing them would drop one.
 */
describe('combo-meal position aggregation', () => {
  const debtIncrease = (amount: bigint): RecipePositionInfo => ({
    protocol: 'morpho-blue',
    marketOrPoolId: MARKET_ID,
    custody: 'address-bound',
    owner: OWNER,
    kind: 'debt',
    direction: 'increase',
    tokenAddress: TOKEN,
    decimals: 6n,
    amount,
  });

  const runPositionSeam = async (
    upstream: RecipePositionInfo[],
    downstream: RecipePositionInfo[],
  ): Promise<RecipeOutput> => {
    const combo = new TestComboMeal(
      [
        new CapturingRecipe({
          ...emptyOutput('upstream'),
          outputPositions: upstream,
        }),
        new CapturingRecipe({
          ...emptyOutput('downstream'),
          outputPositions: downstream,
        }),
      ],
      false,
    );
    return combo.getComboMealOutput(comboInput());
  };

  it('Should keep both records when the same leg moves in both recipes', async () => {
    const output = await runPositionSeam(
      [debtIncrease(100n)],
      [debtIncrease(50n)],
    );
    expect(output.outputPositions).to.have.length(2);
    expect(output.outputPositions.map(({ amount }) => amount)).to.deep.equal([
      100n,
      50n,
    ]);
  });

  it('Should preserve recipe order', async () => {
    const output = await runPositionSeam(
      [debtIncrease(1n), debtIncrease(2n)],
      [debtIncrease(3n)],
    );
    expect(output.outputPositions.map(({ amount }) => amount)).to.deep.equal([
      1n,
      2n,
      3n,
    ]);
  });

  it('Should not carry positions into the downstream recipe input', async () => {
    // The channel is output-only on purpose: no step consumes a position, and
    // threading one in would create a second source of truth beside the
    // on-chain reader. RecipeInput has no place to put it, and this asserts the
    // seam does not grow one by accident.
    const downstream = new CapturingRecipe(emptyOutput('downstream'));
    const combo = new TestComboMeal(
      [
        new CapturingRecipe({
          ...emptyOutput('upstream'),
          outputPositions: [debtIncrease(100n)],
        }),
        downstream,
      ],
      false,
    );
    await combo.getComboMealOutput(comboInput());
    expect(Object.keys(downstream.receivedInput ?? {})).to.deep.equal([
      'railgunAddress',
      'networkName',
      'erc20Amounts',
      'nfts',
    ]);
  });

  it('Should emit an empty channel for a combo that touches no position', async () => {
    const output = await runPositionSeam([], []);
    expect(output.outputPositions).to.deep.equal([]);
  });
});

/**
 * A combo runs every constituent recipe inside ONE relay-adapt batch, so its
 * declared floor cannot coherently be lower than the dearest recipe it wraps.
 *
 * The base class used to emit `config.minGasLimit` verbatim, and five of the
 * seven shipped combos take the generic `MIN_GAS_LIMIT_COMBO_MEAL` (2.9M) while
 * wrapping recipes sized 3.0M–3.1M — so they each declared a floor below their
 * own worst leg, plus an extra swap on top. The floor is enforced in-contract
 * as a `gasleft()` require, so the consequence is an under-provisioned batch
 * that reverts at the shield epilogue with the value stranded at the executor.
 */
describe('combo-meal minGasLimit aggregation', () => {
  class FlooredRecipe extends CapturingRecipe {
    readonly config: RecipeConfig;

    constructor(minGasLimit: bigint) {
      super(emptyOutput('floored'));
      this.config = { name: 'floored', description: '', minGasLimit };
    }
  }

  class FlooredComboMeal extends TestComboMeal {
    readonly config: ComboMealConfig;

    constructor(minGasLimit: bigint, recipes: Recipe[]) {
      super(recipes, false);
      this.config = { name: 'floored-combo', description: '', minGasLimit };
    }
  }

  const runFloor = async (
    comboFloor: bigint,
    recipeFloors: bigint[],
  ): Promise<bigint> => {
    const combo = new FlooredComboMeal(
      comboFloor,
      recipeFloors.map(f => new FlooredRecipe(f)),
    );
    const output = await combo.getComboMealOutput(comboInput());
    return output.minGasLimit;
  };

  it('lifts the emitted floor to the dearest constituent recipe', async () => {
    // The shipped shape: MIN_GAS_LIMIT_COMBO_MEAL wrapping an fx open recipe.
    expect(await runFloor(2_900_000n, [2_400_000n, 3_100_000n])).to.equal(
      3_100_000n,
    );
  });

  it("keeps the combo's own floor when it is already the larger number", async () => {
    // A combo is more than the sum of its legs — the seam, the extra swap and
    // the shield epilogue are not attributable to any single recipe — so its
    // own config must still win when it is higher. This is what keeps the fix
    // from silently *lowering* anything.
    expect(await runFloor(3_500_000n, [2_400_000n, 3_100_000n])).to.equal(
      3_500_000n,
    );
  });

  it('is unaffected when no recipe declares a floor', async () => {
    expect(await runFloor(2_900_000n, [0n, 0n])).to.equal(2_900_000n);
  });
});
