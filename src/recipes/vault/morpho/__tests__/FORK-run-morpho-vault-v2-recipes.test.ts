import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName, TXIDVersion } from '@railgun-community/shared-models';
import { ZeroAddress } from 'ethers';
import { balanceForERC20Token } from '@railgun-community/wallet';
import { MorphoVaultV2DepositRecipe } from '../metamorpho-deposit-recipe';
import { MorphoVaultV2RedeemRecipe } from '../metamorpho-withdraw-recipe';
import { RecipeInput } from '../../../../models/export-models';
import { setRailgunFees } from '../../../../init';
import {
  getTestProvider,
  getTestRailgunWallet,
} from '../../../../test/shared.test';
import {
  MOCK_RAILGUN_WALLET_ADDRESS,
  MOCK_SHIELD_FEE_BASIS_POINTS,
  MOCK_UNSHIELD_FEE_BASIS_POINTS,
} from '../../../../test/mocks.test';
import {
  executeRecipeStepsAndAssertUnshieldBalances,
  shouldSkipForkTest,
} from '../../../../test/common.test';
import { testConfig } from '../../../../test/test-config.test';
import { MetaMorphoVaultContract } from '../../../../contract/vault/morpho/metamorpho-vault-contract';
import { MorphoVaultAPI } from '../../../../api/vault/morpho';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Ethereum;
const txidVersion = TXIDVersion.V2_PoseidonMerkle;

// Morpho Vault V2 (Steakhouse Prime USDC), asset = USDC (6 decimals), shares
// 18 decimals. Vault V2's maxDeposit() returns 0 by spec — the recipe/API use
// only preview* so this works; a real allocator cap could still revert a large
// deposit, so we keep the deposit modest.
const vaultAddress = testConfig.contractsEthereum.steakPrimeUSDCVaultV2;
const usdcAddress = testConfig.contractsEthereum.usdc;

const RECIPIENT = '0x1111111111111111111111111111111111111111';
const slippageBasisPoints = 100n; // 1%
const oneUSDC = 10n ** 6n;

const afterUnshieldFee = (amount: bigint): bigint =>
  amount - (amount * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
const shieldFeeOf = (amount: bigint): bigint =>
  (amount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

describe('FORK-run-morpho-vault-v2-recipes', function run() {
  this.timeout(120000);

  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  // The recipes below only build because this vault is UNGATED. A curator can
  // attach a gate at any time, at which point every deposit and redemption
  // reverts for the ephemeral executor — silently, since relay-adapt runs the
  // cross-contract calls with requireSuccess = false. Assert the precondition
  // explicitly so a gate shows up here as one clear failure rather than as
  // three recipes that suddenly refuse to build.
  it('[FORK] Should report the V2 vault as a Vault V2 with no gates attached', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const gates = await MorphoVaultAPI.getVaultGates(
      vaultAddress,
      getTestProvider(),
    );
    expect(gates.supportsGates).to.equal(true);
    expect(gates.receiveSharesGate).to.equal(ZeroAddress);
    expect(gates.sendSharesGate).to.equal(ZeroAddress);
    expect(gates.receiveAssetsGate).to.equal(ZeroAddress);
    expect(gates.sendAssetsGate).to.equal(ZeroAddress);
    expect(gates.isGated).to.equal(false);
  });

  it('[FORK] Should run morpho-vault-v2-deposit-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const railgunWallet = getTestRailgunWallet();

    const depositRecipe = new MorphoVaultV2DepositRecipe(
      vaultAddress,
      slippageBasisPoints,
      RECIPIENT,
      provider,
    );
    expect(depositRecipe.id.length).to.equal(16);

    const depositAmount = oneUSDC * 100n;
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        { tokenAddress: usdcAddress, decimals: 6n, amount: depositAmount },
      ],
      nfts: [],
    };

    const initialShareBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultAddress,
      false,
    );

    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const expectedShares = await vault.previewDeposit(
      afterUnshieldFee(depositAmount),
    );
    const expectedShareBalance =
      initialShareBalance + expectedShares - shieldFeeOf(expectedShares);

    const recipeOutput = await depositRecipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      depositRecipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const shareBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultAddress,
      false,
    );

    expect(shareBalance > initialShareBalance).to.equal(
      true,
      'Expected private V2 vault-share balance to increase after deposit',
    );
    const low = (expectedShareBalance * 995n) / 1000n;
    const high = (expectedShareBalance * 1005n) / 1000n;
    expect(shareBalance >= low && shareBalance <= high).to.equal(
      true,
      `Private V2 share balance ${shareBalance} outside expected band [${low}, ${high}]`,
    );
  });

  it('[FORK] Should run morpho-vault-v2-redeem-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const railgunWallet = getTestRailgunWallet();

    const redeemRecipe = new MorphoVaultV2RedeemRecipe(
      vaultAddress,
      slippageBasisPoints,
      RECIPIENT,
      provider,
    );
    expect(redeemRecipe.id.length).to.equal(16);

    const redeemShares = 10n ** 18n;
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        { tokenAddress: vaultAddress, decimals: 18n, amount: redeemShares },
      ],
      nfts: [],
    };

    const initialUSDCBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      usdcAddress,
      false,
    );

    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const expectedAssets = await vault.previewRedeem(
      afterUnshieldFee(redeemShares),
    );
    const expectedUSDCBalance =
      initialUSDCBalance + expectedAssets - shieldFeeOf(expectedAssets);

    const recipeOutput = await redeemRecipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      redeemRecipe.config.name,
      recipeInput,
      recipeOutput,
    );

    const usdcBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      usdcAddress,
      false,
    );

    expect(usdcBalance > initialUSDCBalance).to.equal(
      true,
      'Expected private USDC balance to increase after V2 redeem',
    );
    const low = (expectedUSDCBalance * 995n) / 1000n;
    const high = (expectedUSDCBalance * 1005n) / 1000n;
    expect(usdcBalance >= low && usdcBalance <= high).to.equal(
      true,
      `Private USDC balance ${usdcBalance} outside expected band [${low}, ${high}]`,
    );
  });
});
