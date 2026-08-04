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
  // Morpho Blue steps + market math — the same gap as the vault one above,
  // reopened one directory over: `steps/index.ts` listed `./vault` but not
  // `./morpho`, so the Blue steps, `getMarketId`, `WAD`, `ORACLE_PRICE_SCALE`
  // and `borrowAssetsForShares` were unreachable from the package root even
  // though `MorphoBlueAPI` and every Blue recipe that consumes them were
  // exported.
  MORPHO_BLUE_ADDRESS,
  MorphoBlueSupplyCollateralStep,
  MorphoBlueBorrowStep,
  MorphoBlueRepayStep,
  MorphoBlueRepaySharesStep,
  MorphoBlueWithdrawCollateralStep,
  MorphoBlueSetAuthorizationStep,
  getMarketId,
  borrowAssetsForShares,
  computeMorphoBlueRisk,
  accrueMorphoBlueInterest,
  morphoBlueLiquidationIncentiveFactor,
  ORACLE_PRICE_SCALE,
  MorphoBlueAPI,
  // owner/receiver seam — the two validators behind the split. A consumer that
  // cannot reach them has to re-derive the relay-adapt policy by hand, and the
  // read/write divergence is exactly the part that is easy to get backwards.
  resolvePositionOwnerAddress,
  resolvePositionOwnerAddressForRead,
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
import type { MorphoVaultVersion, PositionOwner } from '../index';

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

  it('Should expose the Morpho Blue steps and market math from the root barrel', () => {
    expect(MORPHO_BLUE_ADDRESS).to.be.a('string');
    expect(MorphoBlueSupplyCollateralStep).to.be.a('function');
    expect(MorphoBlueBorrowStep).to.be.a('function');
    expect(MorphoBlueRepayStep).to.be.a('function');
    expect(MorphoBlueRepaySharesStep).to.be.a('function');
    expect(MorphoBlueWithdrawCollateralStep).to.be.a('function');
    expect(MorphoBlueSetAuthorizationStep).to.be.a('function');
    expect(getMarketId).to.be.a('function');
    expect(borrowAssetsForShares).to.be.a('function');
    expect(ORACLE_PRICE_SCALE).to.be.a('bigint');
  });

  it('Should expose the Morpho Blue risk reader from the root barrel', () => {
    // A Blue borrow can be liquidated by anyone at any time with no wallet
    // involvement, so this reader is the only warning a holder gets. It is
    // useless if a consumer cannot reach it.
    expect(computeMorphoBlueRisk).to.be.a('function');
    expect(accrueMorphoBlueInterest).to.be.a('function');
    expect(morphoBlueLiquidationIncentiveFactor).to.be.a('function');
    expect(MorphoBlueAPI.getMarket).to.be.a('function');
    expect(MorphoBlueAPI.getPositionRisk).to.be.a('function');
    expect(MorphoBlueAPI.getPositionRisks).to.be.a('function');
    expect(MorphoBlueAPI.buildPositionRisk).to.be.a('function');
  });

  it('Should expose the owner/receiver seam from the root barrel', () => {
    // `PositionOwner` is a type; naming it in a value position is the
    // assertion, as with MorphoVaultVersion above.
    const owner: PositionOwner = MORPHO_BLUE_ADDRESS;
    expect(owner).to.be.a('string');
    expect(resolvePositionOwnerAddress).to.be.a('function');
    expect(resolvePositionOwnerAddressForRead).to.be.a('function');
    // The preflight that makes owner !== receiver safe to express.
    expect(MorphoBlueAPI.getAuthorization).to.be.a('function');
    expect(MorphoBlueAPI.assertAuthorized).to.be.a('function');
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
