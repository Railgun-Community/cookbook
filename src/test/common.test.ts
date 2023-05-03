import { balanceForERC20Token } from '@railgun-community/quickstart';
import {
  NETWORK_CONFIG,
  NetworkName,
  delay,
} from '@railgun-community/shared-models';
import { BigNumber } from 'ethers';
import { RecipeInput } from '../models/export-models';
import { Recipe } from '../recipes';
import {
  createQuickstartCrossContractCallsForTest,
  getTestEthersWallet,
  getTestRailgunWallet,
} from './shared.test';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

const SCAN_BALANCE_DELAY = 5000;

export const executeRecipeAndAssertUnshieldBalances = async (
  networkName: NetworkName,
  recipe: Recipe,
  recipeInput: RecipeInput,
  expectedGasWithin50K: number,
) => {
  const railgunWallet = getTestRailgunWallet();

  // Get original balances for all unshielded ERC20s.
  const preRecipeUnshieldMap: Record<
    string,
    { unshieldAmount: BigNumber; originalBalance: BigNumber }
  > = {};
  await Promise.all(
    recipeInput.unshieldRecipeERC20Amounts.map(
      async ({ tokenAddress, amount }) => {
        const balance = (await balanceForERC20Token(
          railgunWallet,
          networkName,
          tokenAddress,
        )) as BigNumber;

        preRecipeUnshieldMap[tokenAddress] = {
          unshieldAmount: amount,
          originalBalance: balance,
        };
      },
    ),
  );

  const recipeOutput = await recipe.getRecipeOutput(recipeInput);

  const { gasEstimateString, transaction } =
    await createQuickstartCrossContractCallsForTest(networkName, recipeOutput);

  expect(
    BigNumber.from(gasEstimateString).gte(expectedGasWithin50K - 50_000),
  ).to.equal(
    true,
    `Gas estimate lower than expected range: expected within 50k of ${expectedGasWithin50K}`,
  );
  expect(
    BigNumber.from(gasEstimateString).lte(expectedGasWithin50K + 50_000),
  ).to.equal(
    true,
    `Gas estimate higher than expected range: expected within 50k of ${expectedGasWithin50K}`,
  );

  const wallet = getTestEthersWallet();
  const txResponse = await wallet.sendTransaction(transaction);
  await txResponse.wait();

  // Wait for private balances to re-scan.
  // TODO: Possible race condition - maybe watch for scan events instead.
  await delay(SCAN_BALANCE_DELAY);
  const { chain } = NETWORK_CONFIG[networkName];
  await railgunWallet.scanBalances(chain, () => {});

  const shieldTokenMap: Record<string, BigNumber> = {};
  const shieldStepOutput =
    recipeOutput.stepOutputs[recipeOutput.stepOutputs.length - 1];
  shieldStepOutput.outputERC20Amounts.forEach(shieldERC20Output => {
    shieldTokenMap[shieldERC20Output.tokenAddress] =
      shieldERC20Output.expectedBalance;
  });

  await Promise.all(
    recipeInput.unshieldRecipeERC20Amounts.map(async ({ tokenAddress }) => {
      const postBalance = (await balanceForERC20Token(
        railgunWallet,
        networkName,
        tokenAddress,
      )) as BigNumber;
      const { originalBalance, unshieldAmount } =
        preRecipeUnshieldMap[tokenAddress];

      // Expected balance is original balance - unshielded amount + shielded amount.
      const expectedBalance = originalBalance
        .sub(unshieldAmount)
        .add(shieldTokenMap[tokenAddress] ?? 0);

      expect(postBalance.toString()).to.equal(
        expectedBalance.toString(),
        'Did not get expected balance for unshielded (possibly reshielded) token',
      );
    }),
  );
};
