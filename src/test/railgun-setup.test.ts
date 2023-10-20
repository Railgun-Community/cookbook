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

export const startRailgunForTests = () => {
  const testWalletSource = 'cookbook tests';
  const shouldDebug = true;

  dbgRailgunSetup('Starting RAILGUN Engine...');

  startRailgunEngine(
    testWalletSource,
    db,
    shouldDebug,
    testArtifactStore,
    false, // useNativeArtifacts
    false, // skipMerkletreeScans
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

export const pollUntilUTXOMerkletreeScanned = async () => {
  dbgRailgunSetup('Polling for UTXO merkletree scan to complete...');
  const status = await poll(
    async () => currentUTXOMerkletreeScanStatus,
    status => status === MerkletreeScanStatus.Complete,
    100,
    60000 / 100, // 60 sec.
  );
  if (status !== MerkletreeScanStatus.Complete) {
    throw new Error(`Merkletree scan should be completed - timed out`);
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
