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
});
