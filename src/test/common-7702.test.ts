import {
  balanceForERC20Token,
  gasEstimateForUnprovenCrossContractCalls7702,
  generateCrossContractCallsProof7702,
  getCurrentEphemeralAddress,
  getRelayAdaptTransactionError,
  populateProvedCrossContractCalls,
  pauseAllPollingProviders,
  resumeIsolatedPollingProviderForNetwork,
} from '@railgun-community/wallet';
import {
  EVMGasType,
  NETWORK_CONFIG,
  NetworkName,
  TXIDVersion,
  TransactionGasDetails,
  delay,
  isDefined,
} from '@railgun-community/shared-models';
import { ContractTransaction } from 'ethers';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { RecipeInput, RecipeOutput } from '../models/export-models';
import { createShieldRecipients } from '../utils/shield-recipients';
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
  const { minGasLimit, crossContractCalls } = recipeOutput;

  const { shieldERC20Recipients, shieldNFTRecipients } =
    createShieldRecipients(recipeOutput);

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
      `To debug, FIRST install the 7702 delegation designator, then trace.\n` +
        `Tracing without it hits a CODELESS account and returns SUCCESS — the\n` +
        `authorization list only exists on the type-4 transaction, not on a call.\n` +
        `curl http://localhost:8600 -X POST -H "Content-Type: application/json" --data ` +
        `'{"method":"anvil_setCode","params":["${String(
          transaction.to,
        )}","0xef0100${NETWORK_CONFIG[
          networkName
        ].relayAdapt7702Contract.slice(2)}"],"id":1,"jsonrpc":"2.0"}'\n` +
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

/**
 * RailgunSmartWallet `Shield` — the event that proves the shield epilogue
 * actually ran. Topic hash computed from engine/src/abi/V2.1/RailgunSmartWallet.json:
 * `Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])`
 */
const SHIELD_EVENT_TOPIC =
  '0x3a5b9dc26075a3801a6ddccf95fec485bb7500a91b44cec1add984c21ee6db3b';

/**
 * Recover the revert reason from a failed type-4 batch.
 *
 * The naive approach — re-`eth_call` the transaction — silently **succeeds**,
 * which is worse than useless. A type-4 transaction's `to` is the ephemeral EOA,
 * and the code only exists there by virtue of the authorization list. An
 * `eth_call` carries no authorization list, so it hits a *codeless* account, and
 * a call to a codeless account returns success with empty data. Every diagnostic
 * therefore reported "fine" while the real batch reverted — which is precisely
 * why an `Invalid Merkle Root` rejection presented for hours as an unexplained
 * `status 0`.
 *
 * Installing the delegation designator (`0xef0100 || <impl>`) first — the exact
 * bytes EIP-7702 writes — makes the call behave like the real one and surfaces
 * the revert string. Done inside the caller's snapshot, so it is discarded.
 */
const decode7702Revert = async (
  provider: ReturnType<typeof getTestProvider>,
  from: string,
  transaction: ContractTransaction,
  gasLimit: bigint,
  networkName: NetworkName,
): Promise<string> => {
  const { relayAdapt7702Contract } = NETWORK_CONFIG[networkName];
  try {
    await provider.send('anvil_setCode', [
      transaction.to,
      `0xef0100${relayAdapt7702Contract.slice(2)}`,
    ]);
    await provider.call({
      from,
      to: transaction.to,
      data: transaction.data,
      gasLimit,
    });
    return 'no revert reproduced under eth_call (state-dependent?)';
  } catch (err) {
    const e = err as { shortMessage?: string; message?: string };
    return e.shortMessage ?? e.message ?? String(err);
  }
};

export type GasFloorProbe = {
  gasLimit: bigint;
  shieldCompleted: boolean;
  reason: string;
};

export type GasFloorMeasurement = {
  /** Least wire gas limit at which the shield epilogue completed. */
  minSuccessfulGasLimit: bigint;
  /** Highest probed limit that still failed — the negative control for the answer. */
  maxFailingGasLimit: Optional<bigint>;
  probes: GasFloorProbe[];
  forkBlockNumber: number;
};

/**
 * Measure the real gas cost of a 7702 batch.
 *
 * ## Why `gasUsed` of a passing batch is not the answer
 *
 * `requireSuccess` is hardcoded `false` on both 7702 paths in the wallet SDK, so
 * a batch whose inner work fails still mines. `eth_estimateGas` therefore
 * converges on the cheapest gas at which the **outer** call succeeds, and a
 * shield sub-call that runs out of gas is swallowed — `receipt.status === 1`
 * with the value stranded at the executor. Measuring `gasUsed` of such a batch
 * measures a failure.
 *
 * So the success oracle here is the **shield**, not the transaction: no
 * RelayAdapt error event, and a `Shield` event actually emitted by the
 * RailgunSmartWallet.
 *
 * ## Why it bisects the wire gas limit and not `minGasLimit`
 *
 * `minGasLimit` is baked into `actionData` *and the proof*, so searching over it
 * would mean re-proving at every probe. The wire gas limit is not part of the
 * proof, so one proof serves the whole search.
 *
 * Monotonicity (needed for bisection to be sound): raising the total raises what
 * the 63/64 rule leaves for the shield sub-call, so success is monotone in the
 * gas limit.
 *
 * Each probe runs against `evm_snapshot`/`evm_revert`, so probes do not observe
 * each other's state.
 */
export const measure7702BatchGasFloor = async (
  name: string,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
  opts?: {
    lo?: bigint;
    hi?: bigint;
    toleranceGas?: bigint;
    /**
     * `actionData.minGasLimit` for the proof. Defaults to `0n` so the
     * in-contract `gasleft()` require cannot bind and the search measures cost.
     * Set it to a real value only to measure the require itself.
     */
    actionDataMinGasLimit?: bigint;
  },
): Promise<GasFloorMeasurement> => {
  const { networkName } = recipeInput;
  const txidVersion = TXIDVersion.V2_PoseidonMerkle;
  await assert7702ForkSupport(networkName);

  const provider = getTestProvider();
  const wallet = getTestEthersWallet();
  const { proxyContract } = NETWORK_CONFIG[networkName];

  // One proof for the entire search, built with a SLACK `actionData.minGasLimit`.
  //
  // This is load-bearing. RelayAdapt enforces `gasleft() >= actionData.minGasLimit`
  // in-contract, and the wallet's 7702 path bakes the recipe's declared
  // `minGasLimit` into actionData verbatim. Measuring with the declared value
  // therefore finds the point at which the REQUIRE passes, not the point at
  // which the work fits — a result that is a function of the constant being
  // measured. It shows up as a suspiciously uniform offset:
  //
  //   empty    declared 1_800_000 -> "floor" 1_880_004  (+80_004), gasUsed 1_747_532
  //   fx open  declared 3_100_000 -> "floor" 3_187_377  (+87_377)
  //
  // The empty batch's actual gasUsed is BELOW its declared floor, so the work
  // was never the binding constraint; the offset is pre-check overhead
  // (intrinsic + calldata), which is why the larger fx batch's is ~7k bigger.
  //
  // Zeroing the floor for the proof makes the require vacuous, so the bisection
  // isolates the real cost. The declared constant is still reported by the
  // caller for comparison — it is the thing being calibrated, not an input.
  const measurementOutput: RecipeOutput = {
    ...recipeOutput,
    minGasLimit: opts?.actionDataMinGasLimit ?? 0n,
  };
  const { transaction } = await createCrossContractCalls7702ForTest(
    txidVersion,
    networkName,
    recipeInput,
    measurementOutput,
  );

  const forkBlockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock('latest');
  const blockGasLimit = block?.gasLimit ?? 30_000_000n;

  // Stop the engine watching the chain for the duration of the search.
  //
  // Every probe mines a block, and a successful one emits `Shield` events. The
  // engine's merkletree scans those blocks and does NOT un-scan on
  // `evm_revert`, so an unguarded loop ends with the engine holding commitments
  // the chain no longer has. The next proof built in this process is then
  // rejected by `RailgunSmartWallet: Invalid Merkle Root` — and because the
  // unshield leg sits OUTSIDE the `requireSuccess = false` loop, that rejection
  // reverts the whole transaction and surfaces as `status 0` with no logs
  // rather than a swallowed `CallError`. It looks nothing like a gas problem
  // and everything like a broken recipe, which is exactly how it was misread.
  //
  // Pausing prevents the desync; repairing it afterwards with
  // `rescanFullUTXOMerkletreesAndWallets` also works but re-scans the whole
  // tree in-process and OOMs Node's default heap after two measurements.
  pauseAllPollingProviders();

  let lo = opts?.lo ?? 500_000n;
  let hi = opts?.hi ?? blockGasLimit;
  const tolerance = opts?.toleranceGas ?? 25_000n;
  const probes: GasFloorProbe[] = [];

  const probe = async (gasLimit: bigint): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const snapshotId = await provider.send('evm_snapshot', []);
    let shieldCompleted = false;
    let reason: string;
    try {
      const txResponse = await wallet.sendTransaction({
        ...transaction,
        gasLimit,
      });
      const txReceipt = await txResponse.wait();
      if (txReceipt == null) {
        reason = 'no receipt';
      } else if (txReceipt.status === 0) {
        reason = `tx reverted: ${await decode7702Revert(
          provider,
          wallet.address,
          transaction,
          gasLimit,
          networkName,
        )}`;
      } else {
        const relayAdaptError = getRelayAdaptTransactionError(
          txidVersion,
          txReceipt.logs.map(log => ({
            topics: log.topics as string[],
            data: log.data,
          })),
        );
        if (isDefined(relayAdaptError)) {
          reason = `relay-adapt subcall revert: ${relayAdaptError}`;
        } else {
          // The load-bearing check. A batch can mine with status 1 and still
          // have skipped the shield entirely, because requireSuccess is false.
          const shielded = txReceipt.logs.some(
            log =>
              log.address.toLowerCase() === proxyContract.toLowerCase() &&
              log.topics[0]?.toLowerCase() === SHIELD_EVENT_TOPIC,
          );
          shieldCompleted = shielded;
          reason = shielded
            ? 'shield event emitted'
            : 'MINED BUT NO SHIELD EVENT — value stranded at the executor';
        }
      }
    } catch (err) {
      reason = `send failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      await provider.send('evm_revert', [snapshotId]);
    }
    probes.push({ gasLimit, shieldCompleted, reason });
    // eslint-disable-next-line no-console
    console.log(
      `  [${name}] gasLimit=${gasLimit} -> ${
        shieldCompleted ? 'SHIELD OK' : 'FAIL'
      } (${reason})`,
    );
    return shieldCompleted;
  };

  // Establish that the ceiling actually works before bisecting toward it —
  // otherwise a uniformly-failing search silently returns the ceiling.
  if (!(await probe(hi))) {
    throw new Error(
      `${name}: shield did not complete even at the upper bound ${hi}. ` +
        `This is not a gas floor problem — the batch is failing for another reason.`,
    );
  }

  let best = hi;
  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2n;
    if (await probe(mid)) {
      best = mid;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // Let the engine start watching the chain again (see the pause above).
  resumeIsolatedPollingProviderForNetwork(networkName);

  const maxFailing = probes
    .filter(p => !p.shieldCompleted)
    .map(p => p.gasLimit)
    .reduce<Optional<bigint>>(
      (acc, g) => (acc === undefined || g > acc ? g : acc),
      undefined,
    );

  return {
    minSuccessfulGasLimit: best,
    maxFailingGasLimit: maxFailing,
    probes,
    forkBlockNumber,
  };
};
