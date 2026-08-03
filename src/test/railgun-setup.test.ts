import {
  ArtifactStore,
  NFTTokenData,
  SnarkJSGroth16,
  TokenType,
  balanceForERC20Token,
  balanceForNFT,
  createRailgunWallet,
  getProver,
  loadProvider,
  populateShield,
  setLoggers,
  setOnBalanceUpdateCallback,
  setOnUTXOMerkletreeScanCallback,
  startRailgunEngine,
  walletForID,
} from '@railgun-community/wallet';
import LevelDOWN from 'leveldown';
import fs from 'fs';
import path from 'path';
import {
  FallbackProviderJsonConfig,
  MerkletreeScanStatus,
  MerkletreeScanUpdateEvent,
  NETWORK_CONFIG,
  NFTTokenType,
  NetworkName,
  RailgunBalancesEvent,
  RailgunERC20AmountRecipient,
  TXIDVersion,
  delay,
  isDefined,
  poll,
} from '@railgun-community/shared-models';
import { testConfig } from './test-config.test';
import { ContractTransaction, Wallet } from 'ethers';
import { debug } from 'debug';
import { ERC20Contract } from '../contract/token/erc20-contract';
import {
  testRPCProvider,
  getTestEthersWallet,
  getTestRailgunWallet,
  setSharedTestRailgunWallet,
  setSharedTestRailgunWallet2,
} from './shared.test';
import { groth16 } from 'snarkjs';
import { getLocalhostRPC, getRPCPort } from './common.test';
import { getRandomShieldPrivateKey } from '../utils/random';
import { ERC721Contract } from '../contract';

const dbgRailgunSetup = debug('railgun:setup');

const dbgRailgunWalletSDK = debug('railgun:wallet');
dbgRailgunWalletSDK.enabled = testConfig.showVerboseLogs;

const ENGINE_TEST_DB = 'test.db';
const db = new LevelDOWN(ENGINE_TEST_DB);

export const removeTestDB = () => {
  fs.rm(ENGINE_TEST_DB, { recursive: true }, () => {
    // console.warn('Error removing test db.');
  });
};

const fileExists = (path: string): Promise<boolean> => {
  return new Promise(resolve => {
    fs.promises
      .access(path)
      .then(() => resolve(true))
      .catch(() => resolve(false));
  });
};

const testArtifactStore = new ArtifactStore(
  fs.promises.readFile,
  async (dir, path, data) => {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path, data);
  },
  fileExists,
);

/**
 * Bound quicksync to the fork's own block, killing the race that otherwise makes
 * fork runs non-reproducible.
 *
 * `quickSyncEventsGraphV2` takes a STARTING block and no end bound, so it always
 * returns commitments up to the *indexer's* head. The engine then validates the
 * reconstructed tree against the *fork's* on-chain root. Any commitment the
 * indexer has that the fork does not fails validation:
 *
 *   Error: Invalid merkleroot: 0e882133… Tree: 3. Index: 54260.
 *
 * where the failing index is exactly the indexer's head commitment. Without a
 * bound the only workable configuration is "fork at head and hope the indexer
 * does not catch up mid-scan" — which is a race, and rules out pinning a block,
 * and therefore rules out comparing two measurements.
 *
 * The SDK gives no injection point (`startRailgunEngine` hardcodes
 * `quickSyncEventsGraph`), but its CommonJS output resolves the binding as a
 * property access at call time — `quick_sync_events_1.quickSyncEventsGraph` —
 * so wrapping the module export before the engine starts is sufficient and
 * needs no patch-package entry.
 *
 * Filtering after the fetch rather than in the GraphQL query means the network
 * cost is unchanged; the point is determinism, not speed.
 */
export const clampQuickSyncToBlock = (maxBlockNumber: number): void => {
  /* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, global-require */
  // The package's `exports` map only publishes ".", so a deep specifier is
  // rejected outright. Resolve the entry point and walk to the file instead —
  // an absolute path bypasses `exports` and still lands on the SAME module-cache
  // entry the SDK's own internal require populated, which is what makes the
  // wrapper visible to `init.js`.
  const walletEntry = require.resolve('@railgun-community/wallet');
  const quickSyncPath = path.join(
    path.dirname(walletEntry),
    'services/railgun/quick-sync/quick-sync-events.js',
  );
  const quickSyncModule = require(quickSyncPath);
  const original = quickSyncModule.quickSyncEventsGraph;
  if (typeof original !== 'function') {
    throw new Error(
      'clampQuickSyncToBlock: could not resolve quickSyncEventsGraph — the wallet SDK layout changed, and an unbounded quicksync will fail merkleroot validation against a pinned fork.',
    );
  }
  const atOrBelow = <T extends { blockNumber: number }>(events: T[]): T[] =>
    events.filter(event => event.blockNumber <= maxBlockNumber);

  quickSyncModule.quickSyncEventsGraph = async (...args: unknown[]) => {
    const events = await original(...args);
    return {
      ...events,
      commitmentEvents: atOrBelow(events.commitmentEvents),
      unshieldEvents: atOrBelow(events.unshieldEvents),
      nullifierEvents: atOrBelow(events.nullifierEvents),
    };
  };
  dbgRailgunSetup(`Quicksync clamped to block ${maxBlockNumber}.`);
  /* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, global-require */
};

export const startRailgunForTests = async () => {
  const testWalletSource = 'cookbook tests';
  const shouldDebug = true;

  dbgRailgunSetup('Starting RAILGUN Engine...');

  await startRailgunEngine(
    testWalletSource,
    db,
    shouldDebug,
    testArtifactStore,
    false, // useNativeArtifacts
    false, // skipMerkletreeScans
    [],
    [],
  );

  setLoggers(
    (msg: string) => dbgRailgunWalletSDK(msg),
    (error: string | Error) => dbgRailgunWalletSDK(error),
  );

  getProver().setSnarkJSGroth16(groth16 as SnarkJSGroth16);
};

export const loadLocalhostFallbackProviderForTests = async (
  networkName: NetworkName,
) => {
  const chainId = NETWORK_CONFIG[networkName].chain.id;
  const port = getRPCPort(networkName);
  const localhostProviderConfig: FallbackProviderJsonConfig = {
    chainId,
    providers: [
      {
        provider: getLocalhostRPC(port),
        priority: 1,
        weight: 2,
      },
    ],
  };

  setOnUTXOMerkletreeScanCallback(utxoMerkletreeHistoryScanCallback);

  dbgRailgunSetup(`Loading provider for chain ${chainId} to RAILGUN Engine.`);
  const pollingInterval = 300;
  await loadProvider(localhostProviderConfig, networkName, pollingInterval);
};

let currentUTXOMerkletreeScanStatus: Optional<MerkletreeScanStatus>;
export const utxoMerkletreeHistoryScanCallback = (
  scanData: MerkletreeScanUpdateEvent,
): void => {
  dbgRailgunSetup(
    `UTXO merkletree scan update: ${Math.round(scanData.progress * 100)}% [${
      scanData.scanStatus
    }]`,
  );
  currentUTXOMerkletreeScanStatus = scanData.scanStatus;
};

/**
 * How long to wait for the UTXO merkletree scan before giving up.
 *
 * `setup.test.ts` wipes `test.db` before every fork run, so each run rescans from
 * RAILGUN genesis. **On Ethereum that takes up to ~10 minutes** — the quicksync
 * pull is large (the V2 client's MAX_QUERY_RESULTS is 16 * 2^16 commitments in a
 * single query) and progress callbacks are sparse, so a run sits at a low
 * percentage for minutes while still making progress.
 *
 * The previous 180s was below that floor, which made every Ethereum fork run
 * fail in `before all` with a message that reads like a broken fork rather than
 * an impatient timeout. 15 minutes gives Ethereum headroom; override with
 * MERKLETREE_SCAN_TIMEOUT_MS for a slower endpoint or a faster chain.
 */
const MERKLETREE_SCAN_TIMEOUT_MS = isDefined(
  process.env.MERKLETREE_SCAN_TIMEOUT_MS,
)
  ? Number(process.env.MERKLETREE_SCAN_TIMEOUT_MS)
  : 900000;

export const pollUntilUTXOMerkletreeScanned = async () => {
  dbgRailgunSetup(
    `Polling for UTXO merkletree scan to complete (timeout ${MERKLETREE_SCAN_TIMEOUT_MS}ms)...`,
  );
  const status = await poll(
    async () => {
      return currentUTXOMerkletreeScanStatus;
    },
    status => status === MerkletreeScanStatus.Complete,
    100,
    MERKLETREE_SCAN_TIMEOUT_MS / 100,
  );
  if (status !== MerkletreeScanStatus.Complete) {
    throw new Error(
      `Merkletree scan should be completed - timed out after ${MERKLETREE_SCAN_TIMEOUT_MS}ms ` +
        `(last status: ${String(currentUTXOMerkletreeScanStatus)}). ` +
        `Raise MERKLETREE_SCAN_TIMEOUT_MS if the scan was still progressing.`,
    );
  }
  dbgRailgunSetup('UTXO merkletree complete');
};

export const createRailgunWalletForTests = async () => {
  const railgunWalletInfo = await createRailgunWallet(
    testConfig.encryptionKey,
    testConfig.railgunMnemonic,
    {},
  );
  if (!isDefined(railgunWalletInfo)) {
    throw new Error('Error creating Railgun wallet.');
  }

  const railgunWallet = walletForID(railgunWalletInfo.id);
  setSharedTestRailgunWallet(railgunWallet);
  dbgRailgunSetup('RAILGUN wallet created.');
};

export const createRailgunWallet2ForTests = async () => {
  const railgunWalletInfo = await createRailgunWallet(
    testConfig.encryptionKey,
    testConfig.railgunMnemonic2,
    {},
  );
  if (!isDefined(railgunWalletInfo)) {
    throw new Error('Error creating Railgun wallet.');
  }

  const railgunWallet = walletForID(railgunWalletInfo.id);
  setSharedTestRailgunWallet2(railgunWallet);
  dbgRailgunSetup('RAILGUN wallet 2 created.');
};

const approveShield = async (wallet: Wallet, tokenAddress: string) => {
  const token = new ERC20Contract(tokenAddress, testRPCProvider);
  const tx = await token.createSpenderApproval(
    testConfig.contractsEthereum.proxy,
    10n ** 18n * 10000000n, // 1 MM approved
  );
  return sendTransactionWithRetries(wallet, tx);
};

const approveShieldERC721Collection = async (
  wallet: Wallet,
  nftAddress: string,
) => {
  const token = new ERC721Contract(nftAddress);
  const tx = await token.createSpenderApprovalForAll(
    testConfig.contractsEthereum.proxy,
  );
  return sendTransactionWithRetries(wallet, tx);
};

export const shieldAllTokensForTests = async (
  networkName: NetworkName,
  tokenAddresses: string[],
) => {
  const wallet = getTestEthersWallet();

  dbgRailgunSetup('Approving all tokens for shielding...');

  for (let i = 0; i < tokenAddresses.length; i++) {
    await approveShield(wallet, tokenAddresses[i]);
  }

  dbgRailgunSetup('Shielding tokens... This may take 5-10 seconds.');

  const testRailgunWallet = getTestRailgunWallet();
  const railgunAddress = testRailgunWallet.getAddress();

  const oneThousand18Decimals = 10n ** 18n * 1000n;
  const erc20Amounts: RailgunERC20AmountRecipient[] = tokenAddresses.map(
    tokenAddress => ({
      tokenAddress,
      amount: oneThousand18Decimals,
      recipientAddress: railgunAddress,
    }),
  );

  const shieldPrivateKey = getRandomShieldPrivateKey();
  const { transaction } = await populateShield(
    TXIDVersion.V2_PoseidonMerkle,
    networkName,
    shieldPrivateKey,
    erc20Amounts,
    [], // nftAmountRecipients
  );

  await sendTransactionWithRetries(wallet, transaction);

  dbgRailgunSetup('Shielded tokens.');
};

export const mintAndShieldERC721 = async (
  networkName: NetworkName,
  nftAddress: string,
  tokenSubID: string,
) => {
  // TODO: Mint NFT with a specified tokenSubID.

  const wallet = getTestEthersWallet();

  dbgRailgunSetup('Approving NFT ERC721 for shielding...');

  await approveShieldERC721Collection(wallet, nftAddress);

  dbgRailgunSetup('Shielding NFT...');

  const testRailgunWallet = getTestRailgunWallet();
  const railgunAddress = testRailgunWallet.getAddress();

  const shieldPrivateKey = getRandomShieldPrivateKey();
  const { transaction } = await populateShield(
    TXIDVersion.V2_PoseidonMerkle,
    networkName,
    shieldPrivateKey,
    [], // erc20Amounts
    [
      {
        nftAddress,
        tokenSubID,
        amount: 1n,
        nftTokenType: NFTTokenType.ERC721,
        recipientAddress: railgunAddress,
      },
    ],
  );

  await sendTransactionWithRetries(wallet, transaction);

  dbgRailgunSetup('Shielded ERC721.');
};

const sendTransactionWithRetries = async (
  wallet: Wallet,
  transaction: ContractTransaction,
  retryCount = 0,
): Promise<void> => {
  try {
    transaction.nonce = await wallet.getNonce('latest');
    await wallet.sendTransaction(transaction);
  } catch (err) {
    if (retryCount < 3) {
      await delay(300);
      return sendTransactionWithRetries(wallet, transaction, retryCount + 1);
    }
    dbgRailgunSetup(err);
    throw new Error(`Could not send SHIELD transaction. See error output.`);
  }
};

export const waitForShieldedTokenBalances = async (
  txidVersion: TXIDVersion,
  networkName: NetworkName,
  tokenAddresses: string[],
) => {
  const onBalancesUpdate = (balancesEvent: RailgunBalancesEvent) => {
    dbgRailgunWalletSDK('onBalancesUpdate', balancesEvent);
  };
  setOnBalanceUpdateCallback(onBalancesUpdate);

  dbgRailgunSetup('Scanning private balances and populating test.db...');

  const testRailgunWallet = getTestRailgunWallet();

  const tokenBalanceGetter = (
    tokenAddress: string,
  ): (() => Promise<bigint>) => {
    dbgRailgunSetup(`Polling for updated token balance... ${tokenAddress}`);
    return () =>
      balanceForERC20Token(
        txidVersion,
        testRailgunWallet,
        networkName,
        tokenAddress,
        false, // onlySpendable not required - POI is not necessary for tests
      );
  };

  await Promise.all(
    tokenAddresses.map(async tokenAddress => {
      const balance = await poll(
        tokenBalanceGetter(tokenAddress),
        balance => balance >= 997500000000000000000n,
        100, // Delay in MS
        300, // Iterations - 30sec total
      );
      if (!isDefined(balance)) {
        throw new Error(`Could not find shielded balance for ${tokenAddress}`);
      }
    }),
  );

  dbgRailgunSetup('Shielded token balances found. Test setup complete.');
};

export const waitForShieldedNFTBalance = async (
  txidVersion: TXIDVersion,
  networkName: NetworkName,
  nftAddress: string,
  tokenSubID: string,
) => {
  const onBalancesUpdate = (balancesEvent: RailgunBalancesEvent) => {
    dbgRailgunWalletSDK('onBalancesUpdate', balancesEvent);
  };
  setOnBalanceUpdateCallback(onBalancesUpdate);

  dbgRailgunSetup('Scanning private balances and populating test.db...');

  const testRailgunWallet = getTestRailgunWallet();

  const nftTokenData: NFTTokenData = {
    tokenAddress: nftAddress,
    tokenSubID,
    tokenType: TokenType.ERC721,
  };

  const balance = await poll(
    () =>
      balanceForNFT(
        txidVersion,
        testRailgunWallet,
        networkName,
        nftTokenData,
        false, // onlySpendable not required - POI is not necessary for tests
      ),
    balance => balance === 1n,
    100, // Delay in MS
    300, // Iterations - 30sec total
  );
  if (!isDefined(balance)) {
    throw new Error(`Could not find shielded balance for NFT: ${nftAddress}`);
  }

  dbgRailgunSetup('Shielded NFT balance found. Test setup complete.');
};
