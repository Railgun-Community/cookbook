import {
  balanceForERC20Token,
  gasEstimateForUnprovenCrossContractCalls7702,
  generateCrossContractCallsProof7702,
  getCurrentEphemeralAddress,
  getRelayAdaptTransactionError,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import {
  EVMGasType,
  NETWORK_CONFIG,
  NetworkName,
  RailgunERC20Recipient,
  RailgunNFTAmountRecipient,
  TXIDVersion,
  TransactionGasDetails,
  delay,
  isDefined,
} from '@railgun-community/shared-models';
import { ContractTransaction } from 'ethers';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeInput, RecipeOutput } from '../models/export-models';
import {
  getTestEthersWallet,
  getTestProvider,
  getTestRailgunWallet,
} from './shared.test';
import { testConfig } from './test-config.test';
import { getForkTestNetworkName, shouldSkipForkTest } from './common.test';
import { ForkRPCType } from './rpc-setup.test';
import { ERC20Contract } from '../contract';

chai.use(chaiAsPromised);
const { expect } = chai;

const SCAN_BALANCE_WAIT = 5000;

/**
 * EIP-7702 harness, parallel to `executeRecipeStepsAndAssertUnshieldBalances`
 * in common.test.ts.
 *
 * ## Why this exists separately
 *
 * The relay-adapt harness routes cross-contract calls through the RelayAdapt
 * contract, so `msg.sender` for every call is relay-adapt. Every 7702 combo
 * calls `resolveExecutorAddress`, which **rejects** the relay-adapt address by
 * design — so those combos are structurally untestable on the old path, not
 * merely untested. Under 7702 the executor is an ephemeral EOA that the wallet
 * derives, the unshield lands there, and the batch runs as a type-4
 * transaction whose `to` is the ephemeral EOA itself (delegated to
 * RelayAdapt7702 via the authorization list).
 *
 * The old harness is deliberately left untouched.
 */

/**
 * Which fork RPC is in use. Mirrors the resolution order in setup.test.ts —
 * kept in sync by hand, since setup.test.ts computes it locally and does not
 * export it.
 */
const getForkRPCType = (): ForkRPCType => {
  return isDefined(process.env.USE_GANACHE)
    ? ForkRPCType.Ganache
    : isDefined(process.env.USE_HARDHAT)
      ? ForkRPCType.Hardhat
      : ForkRPCType.Anvil;
};

/**
 * Type-4 transactions need a Prague-or-later EVM. Anvil forking a recent
 * mainnet block has it; **ganache does not implement EIP-7702 at all**, and it
 * fails with an opaque RPC error rather than anything a reader can act on. Skip
 * instead, and say why.
 */
export const shouldSkip7702ForkTest = (networkName: NetworkName): boolean => {
  if (shouldSkipForkTest(networkName)) {
    return true;
  }
  const forkRPCType = getForkRPCType();
  if (forkRPCType === ForkRPCType.Ganache) {
    // eslint-disable-next-line no-console
    console.log(
      'Skipping 7702 fork test: ganache does not support EIP-7702 (type-4) transactions. Use anvil (the default) or hardhat.',
    );
    return true;
  }
  const { supports7702 } = NETWORK_CONFIG[networkName];
  if (!supports7702) {
    // eslint-disable-next-line no-console
    console.log(
      `Skipping 7702 fork test: ${networkName} is not configured for 7702.`,
    );
    return true;
  }
  return false;
};

/**
 * Preflight the fork before spending proof-generation time on it. Two things
 * can be wrong in ways that produce misleading downstream errors:
 *
 *  1. the RelayAdapt7702 contract is not present at the configured address —
 *     ie. the fork block predates its deployment
 *  2. the EVM rejects type-4 — ie. the fork's hardfork predates Prague
 *
 * (2) is detected by attempting an `eth_call` with `type: 4`. A node without
 * 7702 rejects the transaction *shape*; one with it will fail on something else
 * or succeed, either of which tells us the shape was understood.
 */
export const assert7702ForkSupport = async (
  networkName: NetworkName,
): Promise<void> => {
  const provider = getTestProvider();
  const { relayAdapt7702Contract } = NETWORK_CONFIG[networkName];

  if (!isDefined(relayAdapt7702Contract) || relayAdapt7702Contract === '') {
    throw new Error(
      `No relayAdapt7702Contract configured for ${networkName}. Cannot run 7702 fork tests.`,
    );
  }

  const code = await provider.getCode(relayAdapt7702Contract);
  if (code === '0x') {
    throw new Error(
      `RelayAdapt7702 (${relayAdapt7702Contract}) has no code on the fork. The fork block likely predates its deployment — re-fork at a later block.`,
    );
  }
};

const MOCK_TRANSACTION_GAS_DETAILS_TYPE_4: TransactionGasDetails = {
  evmGasType: EVMGasType.Type4,
  gasEstimate: 0n,
  maxFeePerGas: BigInt('0x1234567890'),
  maxPriorityFeePerGas: BigInt('0x123456'),
};

/**
 * The SDK's 7702 proof generator builds the type-4 transaction internally and
 * caches it, but returns a `RelayAdapt7702Request` rather than the transaction.
 * `populateProvedCrossContractCalls` reads that cached transaction back;
 * `setGasDetailsForTransaction` preserves `type === 4` and coerces gas details
 * to Type4, so the authorization list survives. That is why we populate rather
 * than re-encode: `encodeRelayAdapt7702Execute` is not exported from the wallet
 * package barrel, and reaching it would mean a deep import or patching the
 * wallet.
 *
 * The catch: `validateCachedProvedTransaction` compares the populate args
 * against the generate args field by field, and a mismatch throws the
 * unhelpful `Invalid proof for this transaction`. So the arg bundle is built
 * **once** here and shared by all three calls.
 */
export const createCrossContractCalls7702ForTest = async (
  txidVersion: TXIDVersion,
  networkName: NetworkName,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): Promise<{
  gasEstimate: Optional<bigint>;
  transaction: ContractTransaction;
  ephemeralAddress: string;
}> => {
  const railgunWallet = getTestRailgunWallet();

  const { erc20Amounts: unshieldERC20Amounts, nfts: unshieldNFTs } =
    recipeInput;
  const { minGasLimit, crossContractCalls, erc20AmountRecipients, nftRecipients } =
    recipeOutput;

  const shieldERC20Recipients: RailgunERC20Recipient[] =
    erc20AmountRecipients.map(erc20AmountRecipient => ({
      tokenAddress: erc20AmountRecipient.tokenAddress,
      recipientAddress: erc20AmountRecipient.recipient,
    }));

  const shieldNFTRecipients: RailgunNFTAmountRecipient[] = nftRecipients.map(
    nftRecipient => ({
      nftAddress: nftRecipient.nftAddress,
      nftTokenType: nftRecipient.nftTokenType,
      tokenSubID: nftRecipient.tokenSubID,
      amount: nftRecipient.amount,
      recipientAddress: nftRecipient.recipient,
    }),
  );

  // The test signer sponsors the type-4 transaction, so there is no broadcaster
  // fee. Unlike the relay-adapt harness we do not opt into one to get richer
  // revert parsing: a broadcaster fee would change who pays and add an unshield
  // the recipe did not ask for. Reverts are surfaced via the trace hint below
  // instead.
  const broadcasterFeeERC20AmountRecipient = undefined;
  const sendWithPublicWallet = true;

  // Must match the value the SDK's 7702 gas-estimate path pins internally,
  // or validateCachedProvedTransaction rejects the populate.
  const overallBatchMinGasPrice = 0n;

  const ephemeralAddress = await getCurrentEphemeralAddress(
    railgunWallet.id,
    testConfig.encryptionKey,
    networkName,
  );

  let gasEstimate: Optional<bigint>;
  try {
    const { gasEstimate: resolvedGasEstimate } =
      await gasEstimateForUnprovenCrossContractCalls7702(
        txidVersion,
        networkName,
        railgunWallet.id,
        testConfig.encryptionKey,
        unshieldERC20Amounts,
        unshieldNFTs,
        shieldERC20Recipients,
        shieldNFTRecipients,
        crossContractCalls,
        MOCK_TRANSACTION_GAS_DETAILS_TYPE_4,
        undefined, // feeTokenDetails
        sendWithPublicWallet,
        minGasLimit,
      );
    gasEstimate = resolvedGasEstimate;
  } catch (err) {
    // Matches the relay-adapt harness: a failed estimate does not carry revert
    // detail, so continue and let execution surface it.
    // eslint-disable-next-line no-console
    console.error(
      'Received 7702 gas estimate error, which does not contain details of revert. Continuing in order to surface the revert on execution.',
    );
    // eslint-disable-next-line no-console
    console.error(err);
  }

  await generateCrossContractCallsProof7702(
    txidVersion,
    networkName,
    railgunWallet.id,
    testConfig.encryptionKey,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Recipients,
    shieldNFTRecipients,
    crossContractCalls,
    broadcasterFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    minGasLimit,
    () => {}, // progressCallback
  );

  const transactionGasDetails: TransactionGasDetails = {
    ...MOCK_TRANSACTION_GAS_DETAILS_TYPE_4,
    gasEstimate: gasEstimate ?? minGasLimit,
  };

  const { transaction } = await populateProvedCrossContractCalls(
    txidVersion,
    networkName,
    railgunWallet.id,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Recipients,
    shieldNFTRecipients,
    crossContractCalls,
    broadcasterFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    transactionGasDetails,
  );

  // Guard the D1 assumption rather than trusting it: if a future SDK version
  // stops preserving the type-4 shape through populate, fail here with the
  // reason instead of at `sendTransaction` with an opaque RPC error.
  if (transaction.type !== 4) {
    throw new Error(
      `Expected a type-4 (EIP-7702) transaction from populate, got type ${String(
        transaction.type,
      )}. The SDK may no longer round-trip the cached 7702 transaction.`,
    );
  }
  const { authorizationList } = transaction as ContractTransaction & {
    authorizationList?: unknown[];
  };
  if (!isDefined(authorizationList) || authorizationList.length === 0) {
    throw new Error(
      'Type-4 transaction has no authorizationList — the 7702 delegation would not be installed.',
    );
  }
  if (transaction.to !== ephemeralAddress) {
    throw new Error(
      `Type-4 transaction targets ${String(
        transaction.to,
      )}, expected the ephemeral EOA ${ephemeralAddress}.`,
    );
  }

  return { gasEstimate, transaction, ephemeralAddress };
};

/**
 * Execute a recipe through the 7702 path and assert shielded balances settle.
 *
 * Mirrors `executeRecipeStepsAndAssertUnshieldBalances` with three deliberate
 * differences:
 *  - residual-balance assertions target the **ephemeral EOA**, not relay-adapt,
 *    because that is where the unshield lands under 7702
 *  - the executor address is returned to the caller so the test can assert the
 *    recipe was built for that exact address
 *  - the gas window assertion is opt-out (`skipGasWindowAssertion`), because
 *    MIN_GAS_LIMIT_* for the fx/Morpho recipes are unmeasured and would fail the
 *    `[min-200k, min+50k]` window before anything real was tested
 */
export const executeRecipe7702AndAssertUnshieldBalances = async (
  name: string,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
  opts?: {
    expectPossiblePrecisionLossOverflow?: boolean;
    skipGasWindowAssertion?: boolean;
  },
): Promise<{ gasUsed: bigint; ephemeralAddress: string }> => {
  const railgunWallet = getTestRailgunWallet();
  if (recipeInput.railgunAddress !== railgunWallet.getAddress()) {
    throw new Error(
      'Recipe Input must use railgunAddress from testRailgunWallet (ie. MOCK_RAILGUN_WALLET_ADDRESS).',
    );
  }

  const { networkName } = recipeInput;
  const { minGasLimit } = recipeOutput;
  const txidVersion = TXIDVersion.V2_PoseidonMerkle;

  await assert7702ForkSupport(networkName);

  // TODO: Add unshield assertions for ERC721 (NFT) — same gap as the
  // relay-adapt harness; tracked as phase 002 of the 7702 harness plan.

  const preRecipeUnshieldMap: Record<
    string,
    { unshieldAmount: bigint; originalBalance: bigint }
  > = {};
  await Promise.all(
    recipeInput.erc20Amounts.map(async ({ tokenAddress, amount }) => {
      const balance = await balanceForERC20Token(
        txidVersion,
        railgunWallet,
        networkName,
        tokenAddress,
        false, // onlySpendable not required - POI is not necessary for tests
      );
      preRecipeUnshieldMap[tokenAddress] = {
        unshieldAmount: amount,
        originalBalance: balance,
      };
    }),
  );

  const { gasEstimate, transaction, ephemeralAddress } =
    await createCrossContractCalls7702ForTest(
      txidVersion,
      networkName,
      recipeInput,
      recipeOutput,
    );

  if (isDefined(gasEstimate) && !(opts?.skipGasWindowAssertion ?? false)) {
    expect(gasEstimate >= minGasLimit - 200_000n).to.equal(
      true,
      `${name}: Gas estimate lower than expected range: within 200k of ${minGasLimit} - got ${gasEstimate}`,
    );
    expect(gasEstimate <= minGasLimit + 50_000n).to.equal(
      true,
      `${name}: Gas estimate higher than expected range: within 50k of ${minGasLimit} - got ${gasEstimate}`,
    );
  }

  const provider = getTestProvider();
  const wallet = getTestEthersWallet();

  let txReceipt;
  try {
    const txResponse = await wallet.sendTransaction(transaction);
    txReceipt = await txResponse.wait();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    // eslint-disable-next-line no-console
    console.log(
      `To debug, trace the call against the fork:\n` +
        `curl http://localhost:8600 -X POST -H "Content-Type: application/json" ` +
        `--data '{"method":"debug_traceCall","params":[{"from":"${wallet.address}","to":"${String(
          transaction.to,
        )}","data":"${String(
          transaction.data,
        )}"}, "latest"],"id":1,"jsonrpc":"2.0"}' | cut -c 1-1000\n`,
    );
    throw new Error(
      `${name}: Unable to send 7702 transaction. Note a type-4 send also fails if the fork's hardfork predates Prague.`,
      { cause: err },
    );
  }

  if (txReceipt == null) {
    throw new Error('No transaction receipt');
  }

  // RelayAdapt7702 emits the same error events as relay-adapt, so the same
  // parser applies. Absence of an error event is not proof of success on its
  // own — the status check below and the balance assertions carry that.
  const relayAdaptTransactionError = getRelayAdaptTransactionError(
    txidVersion,
    txReceipt.logs.map(log => ({
      topics: log.topics as string[],
      data: log.data,
    })),
  );
  if (isDefined(relayAdaptTransactionError)) {
    throw new Error(
      `${name}: RelayAdapt7702 subcall revert: ${relayAdaptTransactionError}`,
    );
  }
  if (txReceipt.status === 0) {
    throw new Error(
      `${name}: Transaction reverted. Make sure the configured min gas limit is high enough.`,
    );
  }

  await delay(SCAN_BALANCE_WAIT);

  // I3: the ephemeral EOA is a pass-through. Anything left on it is value the
  // recipe failed to account for — the 7702 analogue of the relay-adapt
  // zero-balance assertions.
  const ephemeralETHBalance = await provider.getBalance(ephemeralAddress);
  expect(ephemeralETHBalance).to.equal(
    0n,
    `${name}: Ephemeral EOA ${ephemeralAddress} should hold no ETH after execution.`,
  );

  const shieldTokenMap: Record<string, bigint> = {};
  const shieldStepOutput =
    recipeOutput.stepOutputs[recipeOutput.stepOutputs.length - 1];
  shieldStepOutput.outputERC20Amounts
    .filter(
      shieldERC20Output =>
        !isDefined(shieldERC20Output.recipient) ||
        shieldERC20Output.recipient === recipeInput.railgunAddress,
    )
    .forEach(shieldERC20Output => {
      shieldTokenMap[shieldERC20Output.tokenAddress] =
        shieldERC20Output.expectedBalance;
    });

  await Promise.all(
    recipeInput.erc20Amounts.map(async ({ tokenAddress }) => {
      const token = new ERC20Contract(tokenAddress, provider);
      const ephemeralTokenBalance = await token.balanceOf(ephemeralAddress);
      expect(ephemeralTokenBalance).to.equal(
        0n,
        `${name}: Ephemeral EOA token balance for ${tokenAddress} should be 0 after recipe execution.`,
      );

      const postBalance = await balanceForERC20Token(
        txidVersion,
        railgunWallet,
        networkName,
        tokenAddress,
        false,
      );
      const { originalBalance, unshieldAmount } =
        preRecipeUnshieldMap[tokenAddress];
      const shieldedAmount = shieldTokenMap[tokenAddress] ?? 0n;
      const expectedBalance = originalBalance - unshieldAmount + shieldedAmount;

      if (opts?.expectPossiblePrecisionLossOverflow ?? false) {
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
        `${name}: Did not get expected private balance after unshield/reshield - token ${tokenAddress}`,
      );
    }),
  );

  return { gasUsed: txReceipt.gasUsed, ephemeralAddress };
};

/**
 * Convenience for tests that need the executor address *before* building the
 * recipe (every 7702 combo takes it as `recipient`).
 */
export const getTestEphemeralAddress = async (
  networkName: NetworkName = getForkTestNetworkName(),
): Promise<string> => {
  const railgunWallet = getTestRailgunWallet();
  return getCurrentEphemeralAddress(
    railgunWallet.id,
    testConfig.encryptionKey,
    networkName,
  );
};
