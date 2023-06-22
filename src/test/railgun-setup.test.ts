import {
  ArtifactStore,
  Groth16,
  balanceForERC20Token,
  createRailgunWallet,
  getProver,
  getRandomBytes,
  loadProvider,
  populateShield,
  setLoggers,
  setOnBalanceUpdateCallback,
  startRailgunEngine,
  walletForID,
} from '@railgun-community/wallet';
import LevelDOWN from 'leveldown';
import fs from 'fs';
import {
  FallbackProviderJsonConfig,
  NETWORK_CONFIG,
  NetworkName,
  RailgunBalancesEvent,
  RailgunERC20AmountRecipient,
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
} from './shared.test';
import { groth16 } from 'snarkjs';
import { getLocalhostRPC, getRPCPort } from './common.test';

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

  getProver().setSnarkJSGroth16(groth16 as Groth16);
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

  dbgRailgunSetup(`Loading provider for chain ${chainId} to RAILGUN Engine.`);
  await loadProvider(localhostProviderConfig, networkName);
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

const approveShield = async (wallet: Wallet, tokenAddress: string) => {
  const token = new ERC20Contract(tokenAddress, testRPCProvider);
  const tx = await token.createSpenderApproval(
    testConfig.contractsEthereum.proxy,
    10n ** 18n * 10000000n, // 1 MM approved
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

  dbgRailgunSetup('Shielding tokens... This may take 10-15 seconds.');

  const testRailgunWallet = getTestRailgunWallet();
  const railgunAddress = testRailgunWallet.getAddress();

  const oneThousand18Decimals = 10n ** 18n * 1000n;
  const erc20AmountRecipients: RailgunERC20AmountRecipient[] =
    tokenAddresses.map(tokenAddress => ({
      tokenAddress,
      amount: oneThousand18Decimals,
      recipientAddress: railgunAddress,
    }));

  const shieldPrivateKey = getRandomBytes(32);
  const { transaction } = await populateShield(
    networkName,
    shieldPrivateKey,
    erc20AmountRecipients,
    [], // nftAmountRecipients
  );

  await sendTransactionWithRetries(wallet, transaction);

  dbgRailgunSetup('Shielded tokens.');
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
      balanceForERC20Token(testRailgunWallet, networkName, tokenAddress);
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

  dbgRailgunSetup('---');
  dbgRailgunSetup('Shielded token balances found. Test setup complete.');
  dbgRailgunSetup('---');
};
