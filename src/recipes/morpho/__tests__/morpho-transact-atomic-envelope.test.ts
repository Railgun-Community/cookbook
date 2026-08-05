import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Interface } from 'ethers';
import { NetworkName } from '@railgun-community/shared-models';
import { MorphoTransactRecipe } from '../morpho-transact-recipe';
import {
  BUNDLER3_ADDRESS,
  type MorphoBundle,
} from '../../../api/morpho';
import { setRailgunFees } from '../../../init';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../test/mocks.test';
import type { RecipeInput } from '../../../models/export-models';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const EXECUTOR = '0x1111111111111111111111111111111111111111';
const GENERAL_ADAPTER1 = '0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0'; // pragma: allowlist secret
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // pragma: allowlist secret

const adapter = new Interface([
  'function erc20Transfer(address token, address receiver, uint256 amount)',
]);

const call = (amount: bigint) => ({
  to: GENERAL_ADAPTER1,
  data: adapter.encodeFunctionData('erc20Transfer', [WETH, EXECUTOR, amount]),
  value: 0n,
});

const bundleWith = (callCount: number): MorphoBundle => ({
  initiator: EXECUTOR,
  calls: Array.from({ length: callCount }, (_, i) => call(BigInt(i + 1))),
  pulls: [],
  outputs: [],
});

const recipeInput = (): RecipeInput => ({
  railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
  networkName,
  erc20Amounts: [],
  nfts: [],
});

const buildRecipe = (
  callCount: number,
  options?: { atomicEnvelope?: boolean; allowUndecodedCalls?: boolean },
) =>
  new MorphoTransactRecipe(
    EXECUTOR,
    // eslint-disable-next-line @typescript-eslint/require-await
    async () => bundleWith(callCount),
    undefined as never,
    options,
  );

const targetsOf = (calls: { to?: string }[]) =>
  calls.map(c => (c.to ?? '').toLowerCase());

describe('MorphoTransactRecipe atomic envelope', () => {
  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  it('Should flatten to one relay-adapt entry per call by default', async () => {
    const output = await buildRecipe(3).getRecipeOutput(recipeInput());

    // The default path is unchanged, which is the point of it being opt-in:
    // three calls, three entries, each independently swallowed on failure.
    const morphoCalls = targetsOf(output.crossContractCalls).filter(
      to => to === GENERAL_ADAPTER1.toLowerCase(),
    );
    expect(morphoCalls).to.have.lengthOf(3);
    expect(targetsOf(output.crossContractCalls)).to.not.contain(
      BUNDLER3_ADDRESS.toLowerCase(),
    );
  });

  it('Should compile to a single Bundler3 entry when the envelope is on', async () => {
    const output = await buildRecipe(3, {
      atomicEnvelope: true,
      allowUndecodedCalls: true,
    }).getRecipeOutput(recipeInput());

    const targets = targetsOf(output.crossContractCalls);
    // Three calls become ONE entry, and it targets Bundler3 rather than the
    // adapter — that single entry is what makes the composition all-or-nothing.
    expect(targets).to.contain(BUNDLER3_ADDRESS.toLowerCase());
    expect(
      targets.filter(to => to === GENERAL_ADAPTER1.toLowerCase()),
    ).to.have.lengthOf(0);
    expect(
      targets.filter(to => to === BUNDLER3_ADDRESS.toLowerCase()),
    ).to.have.lengthOf(1);
  });

  it('Should leave a single-call bundle alone even when the envelope is on', async () => {
    const output = await buildRecipe(1, {
      atomicEnvelope: true,
      allowUndecodedCalls: true,
    }).getRecipeOutput(recipeInput());

    // One call is already atomic as its own relay-adapt entry, so the envelope
    // would buy nothing and cost a hop. A no-op rather than an error: the flag
    // states an intent about compositions, and a caller should not have to
    // branch on bundle length.
    const targets = targetsOf(output.crossContractCalls);
    expect(targets).to.contain(GENERAL_ADAPTER1.toLowerCase());
    expect(targets).to.not.contain(BUNDLER3_ADDRESS.toLowerCase());
  });

  it('Should refuse undecodable calls unless the caller opts in', async () => {
    // `erc20Transfer` is not in the set known not to re-enter, so its
    // callbackHash would be guessed as zero. A wrong hash reverts
    // IncorrectReenterHash() INSIDE the envelope — and the envelope is
    // all-or-nothing, so that takes the whole composition.
    await expect(
      buildRecipe(2, { atomicEnvelope: true }).getRecipeOutput(recipeInput()),
    ).to.eventually.be.rejected;
  });

  it('Should ignore allowUndecodedCalls when the envelope is off', async () => {
    // The flag is meaningless without the envelope; it must not change the
    // default path.
    const withFlag = await buildRecipe(2, {
      allowUndecodedCalls: true,
    }).getRecipeOutput(recipeInput());
    const without = await buildRecipe(2).getRecipeOutput(recipeInput());

    expect(targetsOf(withFlag.crossContractCalls)).to.deep.equal(
      targetsOf(without.crossContractCalls),
    );
  });
});
