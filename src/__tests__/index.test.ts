import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  setRailgunFees,
  // Vault steps — reachable from the root barrel only since `steps/index.ts`
  // started exporting `./vault`. Before that, `src/steps/index.ts` listed
  // adapt/token/railgun/swap/borrow and nothing under `steps/vault/` was
  // importable from the package root, even though the metamorpho recipes take
  // `MorphoVaultVersion` as a parameter type. Downstream consumers worked
  // around it by re-declaring the type by hand — these assertions exist so
  // that gap cannot silently reopen.
  BeefyDepositStep,
  BeefyWithdrawStep,
  MetaMorphoDepositStep,
  MetaMorphoWithdrawStep,
  MetaMorphoWithdrawByAssetsStep,
  MORPHO_ADDRESSES,
  KNOWN_METAMORPHO_VAULTS,
  KNOWN_MORPHO_VAULTS_V2,
  // fxMINT position-id predictor — `FxMintOpenRecipe` requires a predicted
  // positionId but shipped no way to obtain one, so consumers hand-rolled the
  // ABI fragment.
  getNextFxPositionId,
  // Gas floors — see the two assertions at the bottom of this file.
  MIN_GAS_LIMIT_COMBO_MEAL,
  MIN_GAS_LIMIT_EMPTY,
  MIN_GAS_LIMIT_FXMINT_OPEN,
  MIN_GAS_LIMIT_FXMINT_ADJUST,
  MIN_GAS_LIMIT_FXMINT_CLOSE,
} from '../index';
import type { MorphoVaultVersion } from '../index';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('index', () => {
  it('Should load index', async () => {
    expect(setRailgunFees).to.be.a('function');
  });

  it('Should expose the vault steps from the root barrel', () => {
    expect(BeefyDepositStep).to.be.a('function');
    expect(BeefyWithdrawStep).to.be.a('function');
    expect(MetaMorphoDepositStep).to.be.a('function');
    expect(MetaMorphoWithdrawStep).to.be.a('function');
    expect(MetaMorphoWithdrawByAssetsStep).to.be.a('function');
  });

  it('Should expose the morpho vault constants and version type', () => {
    expect(MORPHO_ADDRESSES).to.be.an('object');
    expect(KNOWN_METAMORPHO_VAULTS).to.be.an('object');
    expect(KNOWN_MORPHO_VAULTS_V2).to.be.an('object');
    // A type-only import cannot be asserted at runtime; naming it in a value
    // position is the assertion — this file fails to compile if
    // `MorphoVaultVersion` stops being exported from the root.
    const version: MorphoVaultVersion = 'V1';
    expect(version).to.equal('V1');
  });

  it('Should expose the fxMINT position-id reader', () => {
    expect(getNextFxPositionId).to.be.a('function');
  });

  it('Should expose the MIN_GAS_LIMIT_* floors from the root barrel', () => {
    // `src/models/index.ts` omitted `./min-gas-limits`, so a consumer could read
    // `recipeOutput.minGasLimit` but never name the constant behind it — which
    // is what you need to decide whether overriding the floor is safe.
    expect(MIN_GAS_LIMIT_COMBO_MEAL).to.be.a('bigint');
    expect(MIN_GAS_LIMIT_EMPTY).to.be.a('bigint');
    expect(MIN_GAS_LIMIT_FXMINT_OPEN).to.be.a('bigint');
    expect(MIN_GAS_LIMIT_FXMINT_ADJUST).to.be.a('bigint');
    expect(MIN_GAS_LIMIT_FXMINT_CLOSE).to.be.a('bigint');
  });

  it('Should keep every fxMINT floor above the measured empty-recipe floor', () => {
    // MIN_GAS_LIMIT_EMPTY is a real measurement for a recipe that only unshields
    // and shields. Every fx recipe strictly contains that plus an approve plus an
    // operate() that mints or burns an ERC-721, so a floor at or below it
    // under-provisions the batch. The v0.1 values (1.5M vs a 1.8M empty floor)
    // violated this; the assertion exists so they cannot drift back.
    for (const floor of [
      MIN_GAS_LIMIT_FXMINT_OPEN,
      MIN_GAS_LIMIT_FXMINT_ADJUST,
      MIN_GAS_LIMIT_FXMINT_CLOSE,
    ]) {
      expect(floor > MIN_GAS_LIMIT_EMPTY).to.equal(
        true,
        `fxMINT floor ${floor} must exceed MIN_GAS_LIMIT_EMPTY ${MIN_GAS_LIMIT_EMPTY}`,
      );
    }
  });
});
