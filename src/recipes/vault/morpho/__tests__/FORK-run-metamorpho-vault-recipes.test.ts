import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { NetworkName, TXIDVersion } from '@railgun-community/shared-models';
import { balanceForERC20Token } from '@railgun-community/wallet';
import { MorphoVaultV1DepositRecipe } from '../metamorpho-deposit-recipe';
import { MorphoVaultV1RedeemRecipe } from '../metamorpho-withdraw-recipe';
import { MorphoVaultV1WithdrawRecipe } from '../metamorpho-withdraw-by-assets-recipe';
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

// Steakhouse USDC MetaMorpho vault (asset = USDC, 6 decimals).
const vaultAddress = testConfig.contractsEthereum.steakUSDCVault;
const usdcAddress = testConfig.contractsEthereum.usdc;

// The executing ephemeral EOA (EIP-7702) the batch runs as. Placeholder EOA in
// the fork harness — the shares/assets route here rather than relay-adapt.
const RECIPIENT = '0x1111111111111111111111111111111111111111';

const slippageBasisPoints = 100n; // 1%
const oneUSDC = 10n ** 6n;

const afterUnshieldFee = (amount: bigint): bigint =>
  amount - (amount * MOCK_UNSHIELD_FEE_BASIS_POINTS) / 10000n;
const shieldFeeOf = (amount: bigint): bigint =>
  (amount * MOCK_SHIELD_FEE_BASIS_POINTS) / 10000n;

describe('FORK-run-metamorpho-vault-recipes', function run() {
  this.timeout(120000);

  before(() => {
    setRailgunFees(
      networkName,
      MOCK_SHIELD_FEE_BASIS_POINTS,
      MOCK_UNSHIELD_FEE_BASIS_POINTS,
    );
  });

  // Locks the generation discriminator against the real chain. A V1 MetaMorpho
  // vault has no gate mechanism at all, so all four Vault V2 gate getters
  // revert on it — which is exactly what makes them a reliable V1/V2 test. If
  // this ever starts reporting supportsGates, the address is no longer a V1.
  it('[FORK] Should report the V1 vault as having no gate mechanism', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const gates = await MorphoVaultAPI.getVaultGates(
      vaultAddress,
      getTestProvider(),
    );
    expect(gates.supportsGates).to.equal(false);
    expect(gates.isGated).to.equal(false);
  });

  it('[FORK] Should run metamorpho-deposit-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const railgunWallet = getTestRailgunWallet();

    const depositRecipe = new MorphoVaultV1DepositRecipe(
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

    // Deposit produced shares.
    expect(shareBalance > initialShareBalance).to.equal(
      true,
      'Expected private vault-share balance to increase after deposit',
    );
    // Within a 0.5% band of the previewed expectation (rate drift + rounding).
    const low = (expectedShareBalance * 995n) / 1000n;
    const high = (expectedShareBalance * 1005n) / 1000n;
    expect(shareBalance >= low && shareBalance <= high).to.equal(
      true,
      `Private share balance ${shareBalance} outside expected band [${low}, ${high}]`,
    );
  });

  it('[FORK] Should run metamorpho-redeem-recipe', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const railgunWallet = getTestRailgunWallet();

    const withdrawRecipe = new MorphoVaultV1RedeemRecipe(
      vaultAddress,
      slippageBasisPoints,
      RECIPIENT,
      provider,
    );
    expect(withdrawRecipe.id.length).to.equal(16);

    // Redeem a small, funded amount of shares (shares are 18-decimal).
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

    const recipeOutput = await withdrawRecipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      withdrawRecipe.config.name,
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
      'Expected private USDC balance to increase after redeem',
    );
    const low = (expectedUSDCBalance * 995n) / 1000n;
    const high = (expectedUSDCBalance * 1005n) / 1000n;
    expect(usdcBalance >= low && usdcBalance <= high).to.equal(
      true,
      `Private USDC balance ${usdcBalance} outside expected band [${low}, ${high}]`,
    );
  });

  it('[FORK] Should run metamorpho-withdraw-recipe (exact assets)', async function run() {
    if (shouldSkipForkTest(networkName)) {
      this.skip();
      return;
    }

    const provider = getTestProvider();
    const railgunWallet = getTestRailgunWallet();

    // Ask for an exact 1 USDC out; the recipe burns up to the quote's maxShares
    // from the unshielded shares and reshields the remainder.
    const withdrawAssets = oneUSDC;
    const withdrawRecipe = new MorphoVaultV1WithdrawRecipe(
      vaultAddress,
      withdrawAssets,
      slippageBasisPoints,
      RECIPIENT,
      provider,
    );
    expect(withdrawRecipe.id.length).to.equal(16);

    // Vault shares are 18-decimal and ~1 share ≈ 1 USDC, so previewWithdraw(1
    // USDC) ≈ 1e18. Unshield 2 shares — comfortably above the quote's maxShares
    // (= previewWithdraw * (1 + slippage)) even after the unshield fee. NB: the
    // fork wallet must hold >= inputShares shielded vault shares. (The earlier
    // 50-USDC/2-share sizing was inconsistent — maxShares ≈ 50e18 > 2e18 — and
    // threw "Specified amount exceeds balance" inside getRecipeOutput.)
    const vault = new MetaMorphoVaultContract(vaultAddress, provider);
    const previewShares = await vault.previewWithdraw(withdrawAssets);
    const inputShares = 2n * 10n ** 18n;
    const recipeInput: RecipeInput = {
      railgunAddress: MOCK_RAILGUN_WALLET_ADDRESS,
      networkName,
      erc20Amounts: [
        { tokenAddress: vaultAddress, decimals: 18n, amount: inputShares },
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
    const initialShareBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultAddress,
      false,
    );

    const recipeOutput = await withdrawRecipe.getRecipeOutput(recipeInput);
    await executeRecipeStepsAndAssertUnshieldBalances(
      withdrawRecipe.config.name,
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
    const shareBalance = await balanceForERC20Token(
      txidVersion,
      railgunWallet,
      networkName,
      vaultAddress,
      false,
    );

    // Exact-asset withdraw: private USDC increases by ~withdrawAssets minus the
    // shield fee (deterministic asset output).
    const shieldFee = shieldFeeOf(withdrawAssets);
    const expectedUSDCBalance = initialUSDCBalance + withdrawAssets - shieldFee;
    const low = (expectedUSDCBalance * 995n) / 1000n;
    const high = (expectedUSDCBalance * 1005n) / 1000n;
    expect(usdcBalance >= low && usdcBalance <= high).to.equal(
      true,
      `Private USDC balance ${usdcBalance} outside expected band [${low}, ${high}]`,
    );

    // Safety invariant (the property the whole conservative-spend design rests
    // on): only ~previewShares were actually burned; the un-burned remainder of
    // the unshielded inputShares reshielded via the relay-adapt balance sweep
    // rather than stranding in the abandoned ephemeral EOA. Had it stranded,
    // sharesConsumed would be ~inputShares.
    const sharesConsumed = initialShareBalance - shareBalance;
    expect(sharesConsumed < (inputShares * 80n) / 100n).to.equal(
      true,
      `Withdraw consumed ${sharesConsumed} shares (~${previewShares} expected); ` +
        `un-burned remainder must reshield, not strand`,
    );
  });
});
