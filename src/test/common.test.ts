import {
  balanceForERC20Token,
  getRelayAdaptTransactionError,
} from '@railgun-community/wallet';
import {
  NETWORK_CONFIG,
  NetworkName,
  delay,
  isDefined,
} from '@railgun-community/shared-models';
import { RecipeInput, RecipeOutput } from '../models/export-models';
import {
  createQuickstartCrossContractCallsForTest,
  getTestEthersWallet,
  getTestRailgunWallet,
  testRPCProvider,
} from './shared.test';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ERC20Contract } from '../contract';

chai.use(chaiAsPromised);
const { expect } = chai;

const SCAN_BALANCE_WAIT = 11000;

export const shouldSkipForkTest = (networkName: NetworkName) => {
  return (
    !isDefined(process.env.RUN_FORK_TESTS) ||
    process.env.NETWORK_NAME !== networkName
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
  expectedGasWithin50K: bigint,
  expectPossiblePrecisionLossOverflow?: boolean,
) => {
  const railgunWallet = getTestRailgunWallet();

  const { networkName } = recipeInput;

  // Get original balances for all unshielded ERC20s.
  const preRecipeUnshieldMap: Record<
    string,
    { unshieldAmount: bigint; originalBalance: bigint }
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

  const { gasEstimate, transaction } =
    await createQuickstartCrossContractCallsForTest(
      networkName,
      recipeInput,
      recipeOutput,
    );

  if (isDefined(gasEstimate)) {
    expect(gasEstimate >= expectedGasWithin50K - 50_000n).to.equal(
      true,
      `${name}: Gas estimate lower than expected range: within 50k of ${expectedGasWithin50K} - got ${gasEstimate}`,
    );
    expect(gasEstimate <= expectedGasWithin50K + 50_000n).to.equal(
      true,
      `${name}: Gas estimate higher than expected range: within 50k of ${expectedGasWithin50K} - got ${gasEstimate}`,
    );
  }

  const provider = testRPCProvider;
  if (!provider) {
    throw new Error('No test provider');
  }

  const wallet = getTestEthersWallet();

  let txResponse;

  try {
    txResponse = await wallet.sendTransaction(transaction);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);

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

  // TODO: This awaiter is not working as it should - use delay() instead.
  // const { chain } = NETWORK_CONFIG[networkName];
  // const scanAwaiter = promiseTimeout(
  //   awaitWalletScan(railgunWallet.id, chain),
  //   SCAN_BALANCE_WAIT,
  //   new Error(
  //     'Timed out waiting for private balance to re-scans for unshield/transact + shield',
  //   ),
  // );

  const txReceipt = await txResponse.wait();
  if (txReceipt == null) {
    throw new Error('No transaction receipt');
  }

  const relayAdaptTransactionError = getRelayAdaptTransactionError(
    txReceipt.logs,
  );
  if (isDefined(relayAdaptTransactionError)) {
    throw new Error(
      `${name}: Relay Adapt subcall revert: ${relayAdaptTransactionError}`,
    );
  }
  if (txReceipt.status === 0) {
    throw new Error(`${name}: Transaction reverted`);
  }

  // TODO: Wait for private balances to re-scan.
  // await scanAwaiter;

  await delay(SCAN_BALANCE_WAIT);

  const relayAdaptContract = NETWORK_CONFIG[networkName].relayAdaptContract;
  const relayAdaptETHBalance = await provider.getBalance(relayAdaptContract);
  expect(relayAdaptETHBalance).to.equal(0n);

  const shieldTokenMap: Record<string, bigint> = {};
  const shieldStepOutput =
    recipeOutput.stepOutputs[recipeOutput.stepOutputs.length - 1];
  shieldStepOutput.outputERC20Amounts.forEach(shieldERC20Output => {
    shieldTokenMap[shieldERC20Output.tokenAddress] =
      shieldERC20Output.expectedBalance;
  });

  await Promise.all(
    recipeInput.erc20Amounts.map(async ({ tokenAddress }) => {
      const token = new ERC20Contract(tokenAddress, provider);
      const relayAdaptTokenBalance = await token.balanceOf(relayAdaptContract);
      expect(relayAdaptTokenBalance).to.equal(0n);

      const postBalance = await balanceForERC20Token(
        railgunWallet,
        networkName,
        tokenAddress,
      );
      const { originalBalance, unshieldAmount } =
        preRecipeUnshieldMap[tokenAddress];

      // Expected balance is original balance - unshielded amount + shielded amount.
      const shieldedAmount = shieldTokenMap[tokenAddress] ?? 0n;
      const expectedBalance = originalBalance - unshieldAmount + shieldedAmount;

      if (expectPossiblePrecisionLossOverflow ?? false) {
        // NOTE: Balance may be +1 wei because of precision loss.
        expect(
          postBalance >= expectedBalance && postBalance <= expectedBalance + 1n,
        ).to.equal(
          true,
          `${name}: Did not get expected private balance after unshield/reshield - token ${tokenAddress}: expected ${expectedBalance} or ${
            expectedBalance + 1n
          }, got ${postBalance}`,
        );
        return;
      }
      expect(postBalance).to.equal(
        expectedBalance,
        `${name}:  Did not get expected private balance after unshield/reshield - token ${tokenAddress}`,
      );
    }),
  );
};
