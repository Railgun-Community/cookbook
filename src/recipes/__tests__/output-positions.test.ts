import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NFTTokenType, NetworkName } from '@railgun-community/shared-models';
import { CustomRecipe } from '../custom-recipe';
import { Step } from '../../steps/step';
import {
  RecipeAddressBoundPosition,
  RecipeInput,
  StepConfig,
  StepInput,
  UnvalidatedStepOutput,
} from '../../models/export-models';
import { MIN_GAS_LIMIT_ANY_RECIPE } from '../../models/min-gas-limits';
import { ApproveERC20SpenderStep } from '../../steps/token/erc20/approve-erc20-spender-step';
import { MorphoBlueSupplyCollateralStep } from '../../steps/morpho/blue-supply-collateral-step';
import { MorphoBlueBorrowStep } from '../../steps/morpho/blue-borrow-step';
import {
  MarketParams,
  MORPHO_BLUE_ADDRESS,
} from '../../steps/morpho/morpho-blue-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // pragma: allowlist secret
const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78'; // pragma: allowlist secret
const ORACLE = '0xDd1778F71a4a1C6A0eFebd8AE9f8848634CE1101'; // pragma: allowlist secret
const IRM = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC'; // pragma: allowlist secret
const MARKET_ID =
  '0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9';

const OWNER = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const RAILGUN_ADDRESS = '0zktest';

const market: MarketParams = {
  loanToken: USDC,
  collateralToken: PAXG,
  oracle: ORACLE,
  irm: IRM,
  lltv: 915000000000000000n,
};

const COLLATERAL = 1_000_000_000_000_000_000n; // 1 PAXG
const BORROW = 1_500_000_000n; // 1500 USDC

const recipeInput = (): RecipeInput => ({
  networkName,
  railgunAddress: RAILGUN_ADDRESS,
  erc20Amounts: [
    { tokenAddress: PAXG, decimals: 18n, amount: COLLATERAL },
  ],
  nfts: [],
});

/**
 * §6.2's acceptance criterion, verbatim: a Blue supply+borrow's `RecipeOutput`
 * has to describe the resulting position without the caller re-reading chain
 * state.
 *
 * Built on `CustomRecipe` with the unshield/shield legs skipped rather than on
 * `MorphoBlueSupplyCollateralAndBorrowRecipe`, only because that recipe reads
 * token decimals through a `Provider` and this assertion is about the output
 * channel, not about the quote builder. The steps and the aggregation under
 * test are the same ones it uses.
 */
describe('RecipeOutput.outputPositions — Blue supply + borrow', () => {
  const buildRecipe = () => {
    const recipe = new CustomRecipe(
      {
        name: 'blue supply + borrow',
        description: '',
        minGasLimit: MIN_GAS_LIMIT_ANY_RECIPE,
      },
      [networkName],
    );
    recipe.addStep(
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        { tokenAddress: PAXG, decimals: 18n },
        COLLATERAL,
      ),
    );
    recipe.addStep(
      new MorphoBlueSupplyCollateralStep({
        params: market,
        marketId: MARKET_ID,
        collateralToken: PAXG,
        collateralDecimals: 18n,
        collateralAssets: COLLATERAL,
        onBehalf: OWNER,
      }),
    );
    recipe.addStep(
      new MorphoBlueBorrowStep({
        params: market,
        marketId: MARKET_ID,
        loanToken: USDC,
        loanDecimals: 6n,
        borrowAssets: BORROW,
        onBehalf: OWNER,
        receiver: OWNER,
      }),
    );
    return recipe;
  };

  it('Should describe the whole resulting position with no chain read', async () => {
    const output = await buildRecipe().getRecipeOutput(
      recipeInput(),
      true, // skipUnshield
      true, // skipShield
    );

    // Both legs, in step order, from steps 2 and 3 — the approve step in
    // between contributes nothing, so provenance is preserved without gaps.
    expect(
      output.outputPositions.map(position => ({
        ...position,
        // Assert the discriminator separately; keep the shape comparison small.
        custody: position.custody,
      })),
    ).to.deep.equal([
      {
        protocol: 'morpho-blue',
        marketOrPoolId: MARKET_ID,
        custody: 'address-bound',
        owner: OWNER,
        kind: 'collateral',
        direction: 'increase',
        tokenAddress: PAXG,
        decimals: 18n,
        amount: COLLATERAL,
      },
      {
        protocol: 'morpho-blue',
        marketOrPoolId: MARKET_ID,
        custody: 'address-bound',
        owner: OWNER,
        kind: 'debt',
        direction: 'increase',
        tokenAddress: USDC,
        decimals: 6n,
        amount: BORROW,
      },
    ]);

    // "You now hold 1 PAXG in market 0x8eaf… at 0xAb58…, owing 1500 USDC" is
    // derivable from this alone. Nothing in the pre-existing channels says it:
    // the collateral appears only as spent to a human label.
    const spentLabels = output.stepOutputs
      .flatMap(step => step.spentERC20Amounts ?? [])
      .map(spent => spent.recipient);
    expect(spentLabels).to.include('Morpho Blue Market');
  });

  it('Should leave every pre-existing channel unchanged', async () => {
    // "Purely additive" is a claim about the OTHER channels, so it is asserted
    // rather than assumed: adding the position channel must not shift an
    // amount, a recipient, or a call.
    const output = await buildRecipe().getRecipeOutput(
      recipeInput(),
      true,
      true,
    );

    expect(output.crossContractCalls).to.have.length(3);
    expect(output.erc20AmountRecipients).to.deep.equal([
      {
        tokenAddress: PAXG.toLowerCase(),
        decimals: 18n,
        isBaseToken: undefined,
        amount: 0n,
        minBalance: 0n,
        recipient: RAILGUN_ADDRESS,
      },
      {
        tokenAddress: USDC.toLowerCase(),
        decimals: 6n,
        isBaseToken: undefined,
        amount: BORROW,
        minBalance: BORROW,
        recipient: RAILGUN_ADDRESS,
      },
    ]);
    expect(output.nftRecipients).to.deep.equal([]);
    expect(output.feeERC20AmountRecipients).to.deep.equal([]);
  });

  it('Should emit an empty channel for a recipe that touches no position', async () => {
    const recipe = new CustomRecipe(
      { name: 'noop', description: '', minGasLimit: MIN_GAS_LIMIT_ANY_RECIPE },
      [networkName],
    );
    recipe.addStep(
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        { tokenAddress: PAXG, decimals: 18n },
        COLLATERAL,
      ),
    );

    const output = await recipe.getRecipeOutput(recipeInput(), true, true);
    // Present and empty, never undefined — a consumer must not need `?? []`.
    expect(output.outputPositions).to.deep.equal([]);
  });

  it('Should keep both records when two steps touch the same leg', async () => {
    // Two supplies into one market are two events, not one restatement. The
    // ERC20 and NFT channels collapse restatements by design; this one must
    // not, or the second half of the collateral disappears from the output.
    const half = COLLATERAL / 2n;
    const recipe = new CustomRecipe(
      { name: 'double supply', description: '', minGasLimit: 0n },
      [networkName],
    );
    recipe.addStep(
      new ApproveERC20SpenderStep(
        MORPHO_BLUE_ADDRESS,
        { tokenAddress: PAXG, decimals: 18n },
        COLLATERAL,
      ),
    );
    const supplyQuote = (collateralAssets: bigint) => ({
      params: market,
      marketId: MARKET_ID,
      collateralToken: PAXG,
      collateralDecimals: 18n,
      collateralAssets,
      onBehalf: OWNER,
    });
    recipe.addStep(new MorphoBlueSupplyCollateralStep(supplyQuote(half)));
    recipe.addStep(new MorphoBlueSupplyCollateralStep(supplyQuote(half)));

    const output = await recipe.getRecipeOutput(recipeInput(), true, true);
    expect(output.outputPositions).to.have.length(2);
    expect(
      (output.outputPositions as RecipeAddressBoundPosition[]).map(
        position => position.amount,
      ),
    ).to.deep.equal([half, half]);
  });
});

/**
 * The channel gets no conservation check — there is nothing in a step's input
 * to reconcile a position against. These are the two invariants that ARE
 * checkable, so they are the ones the validator enforces.
 */
describe('step validator — outputPositions', () => {
  class PositionStep extends Step {
    readonly config: StepConfig = { name: 'position stub', description: '' };

    private readonly cannedOutput: UnvalidatedStepOutput;

    constructor(cannedOutput: UnvalidatedStepOutput) {
      super();
      this.cannedOutput = cannedOutput;
    }

    protected async getStepOutput(): Promise<UnvalidatedStepOutput> {
      return this.cannedOutput;
    }
  }

  const emptyInput: StepInput = { networkName, erc20Amounts: [], nfts: [] };

  const bearerPosition = (tokenSubID: string) => ({
    protocol: 'fx' as const,
    marketOrPoolId: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8',
    custody: 'bearer' as const,
    nftAddress: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8',
    tokenSubID,
    nftTokenType: NFTTokenType.ERC721,
    kind: 'debt' as const,
    direction: 'increase' as const,
    tokenAddress: USDC,
    decimals: 6n,
    amount: 1n,
  });

  it('Should reject a negative amount rather than read it as a signed delta', async () => {
    const step = new PositionStep({
      crossContractCalls: [],
      outputERC20Amounts: [],
      outputNFTs: [],
      outputPositions: [
        {
          protocol: 'morpho-blue',
          marketOrPoolId: MARKET_ID,
          custody: 'address-bound',
          owner: OWNER,
          kind: 'debt',
          direction: 'decrease',
          tokenAddress: USDC,
          decimals: 6n,
          amount: -1n,
        },
      ],
    });
    await expect(step.getValidStepOutput(emptyInput)).to.be.rejectedWith(
      'position stub step is invalid.',
    );
  });

  it('Should reject a malformed owner on an address-bound position', async () => {
    const step = new PositionStep({
      crossContractCalls: [],
      outputERC20Amounts: [],
      outputNFTs: [],
      outputPositions: [
        {
          protocol: 'morpho-blue',
          marketOrPoolId: MARKET_ID,
          custody: 'address-bound',
          owner: '0x0000000000000000000000000000000000000000',
          kind: 'debt',
          direction: 'increase',
          tokenAddress: USDC,
          decimals: 6n,
          amount: 1n,
        },
      ],
    });
    await expect(step.getValidStepOutput(emptyInput)).to.be.rejectedWith(
      'position stub step is invalid.',
    );
  });

  it('Should reject a bearer position whose NFT the step never declares', async () => {
    const step = new PositionStep({
      crossContractCalls: [],
      outputERC20Amounts: [],
      outputNFTs: [],
      outputPositions: [bearerPosition('0x76f')],
    });
    await expect(step.getValidStepOutput(emptyInput)).to.be.rejectedWith(
      'position stub step is invalid.',
    );
  });

  it('Should match a bearer position across tokenSubID zero-padding', async () => {
    // The record and the NFT are derived independently, so the cross-check has
    // to key the same way the rest of the engine does — otherwise a padded id
    // from a wallet would look like a mismatch.
    const step = new PositionStep({
      crossContractCalls: [],
      outputERC20Amounts: [],
      outputNFTs: [
        {
          nftAddress: '0x6ecfa38fee8a5277b91efda204c235814f0122e8',
          tokenSubID:
            '0x000000000000000000000000000000000000000000000000000000000000076f',
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
      outputPositions: [bearerPosition('0x76f')],
    });
    const output = await step.getValidStepOutput(emptyInput);
    expect(output.outputPositions).to.have.length(1);
  });

  it('Should accept a bearer position backed only by spentNFTs (full close)', async () => {
    const step = new PositionStep({
      crossContractCalls: [],
      outputERC20Amounts: [],
      outputNFTs: [],
      spentNFTs: [
        {
          nftAddress: '0x6Ecfa38FeE8a5277B91eFdA204c235814F0122E8',
          tokenSubID: '0x76f',
          nftTokenType: NFTTokenType.ERC721,
          amount: 1n,
        },
      ],
      outputPositions: [bearerPosition('0x76f')],
    });
    const output = await step.getValidStepOutput(emptyInput);
    expect(output.outputPositions).to.have.length(1);
  });
});
