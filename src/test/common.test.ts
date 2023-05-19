import {
  balanceForERC20Token,
  getRelayAdaptTransactionError,
} from '@railgun-community/quickstart';
import {
  NETWORK_CONFIG,
  NetworkName,
  delay,
} from '@railgun-community/shared-models';
import { BigNumber } from 'ethers';
import { RecipeInput, RecipeOutput } from '../models/export-models';
import {
  createQuickstartCrossContractCallsForTest,
  getTestEthersWallet,
  getTestRailgunWallet,
  testRPCProvider,
} from './shared.test';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

const SCAN_BALANCE_DELAY = 3000;

export const shouldSkipForkTest = (networkName: NetworkName) => {
  return (
    !process.env.RUN_FORK_TESTS || process.env.NETWORK_NAME !== networkName
  );
};

export const getRPCPort = (networkName: NetworkName) => {
  switch (networkName) {
    case NetworkName.Ethereum:
      return 8600;
    case NetworkName.Arbitrum:
      return 8601;
    case NetworkName.BNBChain:
    case NetworkName.Polygon:
    case NetworkName.EthereumRopsten_DEPRECATED:
    case NetworkName.EthereumGoerli:
    case NetworkName.PolygonMumbai:
    case NetworkName.ArbitrumGoerli:
    case NetworkName.Hardhat:
    case NetworkName.Railgun:
      throw new Error('No RPC setup for network');
  }
};

export const getLocalhostRPC = (port: number) => {
  return `http://localhost:${port}`;
};

export const executeRecipeStepsAndAssertUnshieldBalances = async (
  name: string,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
  expectedGasWithin50K: number,
  expectPossiblePrecisionLossOverflow?: boolean,
) => {
  const railgunWallet = getTestRailgunWallet();

  const { networkName } = recipeInput;

  // Get original balances for all unshielded ERC20s.
  const preRecipeUnshieldMap: Record<
    string,
    { unshieldAmount: BigNumber; originalBalance: BigNumber }
  > = {};
  await Promise.all(
    recipeInput.erc20Amounts.map(async ({ tokenAddress, amount }) => {
      const balance = await balanceForERC20Token(
        railgunWallet,
        networkName,
        tokenAddress,
      );

      preRecipeUnshieldMap[tokenAddress] = {
        unshieldAmount: amount,
        originalBalance: balance,
      };
    }),
  );

  const { gasEstimateString, transaction } =
    await createQuickstartCrossContractCallsForTest(
      networkName,
      recipeInput,
      recipeOutput,
    );

  if (gasEstimateString) {
    expect(
      BigNumber.from(gasEstimateString).gte(expectedGasWithin50K - 50_000),
    ).to.equal(
      true,
      `${name}: Gas estimate lower than expected range: within 50k of ${expectedGasWithin50K} - got ${BigNumber.from(
        gasEstimateString,
      ).toString()}`,
    );
    expect(
      BigNumber.from(gasEstimateString).lte(expectedGasWithin50K + 50_000),
    ).to.equal(
      true,
      `${name}: Gas estimate higher than expected range: within 50k of ${expectedGasWithin50K} - got ${BigNumber.from(
        gasEstimateString,
      ).toString()}`,
    );
  }

  const wallet = getTestEthersWallet();

  let txResponse;

  try {
    txResponse = await wallet.sendTransaction(transaction);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);

    const provider = testRPCProvider;
    if (!provider) {
      throw new Error('No test provider');
    }

    // Trace call and parse RelayAdapt log data to get error message.
    const call = {
      from: null,
      to: transaction.to,
      data: transaction.data,
    };

    // NOTE: This fails as output is too large for JS runtime.
    // const trace = await provider.send('debug_traceCall', [call, 'latest']);

    // eslint-disable-next-line no-console
    console.log(
      'Run this command to debug the transaction, followed by `node debug_return_value <returnValue>`:\n',
    );
    // eslint-disable-next-line no-console
    console.log(
      `curl http://localhost:8600 -X POST     -H "Content-Type: application/json"   --data '{"method":"debug_traceCall","params":[{"from":null,"to":"${call.to}","data":"${call.data}"}, "latest"],"id":1,"jsonrpc":"2.0"}' | cut -c 1-1000
      \n`,
    );

    throw new Error(
      'Unable to call transaction. To debug: (1) See above for Anvil RPC debug_traceCall command. Run to capture returnValue. (2) Run `node debug_return_value <returnValue>` at project root to get RelayAdapt error message.',
    );
  }

  const txReceipt = await txResponse.wait();

  const relayAdaptTransactionError = getRelayAdaptTransactionError(
    txReceipt.logs,
  );
  if (relayAdaptTransactionError) {
    throw new Error(
      `${name}: Relay Adapt subcall revert: ${relayAdaptTransactionError}`,
    );
  }

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
    recipeInput.erc20Amounts.map(async ({ tokenAddress }) => {
      const postBalance = await balanceForERC20Token(
        railgunWallet,
        networkName,
        tokenAddress,
      );
      const { originalBalance, unshieldAmount } =
        preRecipeUnshieldMap[tokenAddress];

      // Expected balance is original balance - unshielded amount + shielded amount.
      const expectedBalance = originalBalance
        .sub(unshieldAmount)
        .add(shieldTokenMap[tokenAddress] ?? 0);

      if (expectPossiblePrecisionLossOverflow) {
        // NOTE: Balance may be +1 wei because of precision loss.
        expect(
          postBalance.gte(expectedBalance) &&
            postBalance.lte(expectedBalance.add(1)),
        ).to.equal(
          true,
          `${name}: Did not get expected private balance after unshield/reshield - token ${tokenAddress}: expected ${expectedBalance.toString()} or ${expectedBalance
            .add(1)
            .toString()}, got ${postBalance.toString()}`,
        );
      } else {
        expect(postBalance.toString()).to.equal(
          expectedBalance.toString(),
          `${name}:  Did not get expected private balance after unshield/reshield - token ${tokenAddress}`,
        );
      }
    }),
  );
};
