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
} from '@railgun-community/quickstart';
import LevelDOWN from 'leveldown';
import fs from 'fs';
import {
  FallbackProviderJsonConfig,
  NetworkName,
  RailgunBalancesEvent,
  RailgunERC20AmountRecipient,
  delay,
  deserializeTransaction,
  poll,
} from '@railgun-community/shared-models';
import { testConfig } from './test-config.test';
import { BigNumber, Wallet } from 'ethers';
import { debug } from 'debug';
import { ERC20Contract } from '../contract/token/erc20-contract';
import {
  testRPCProvider,
  getGanacheProvider,
  getTestEthersWallet,
  getTestRailgunWallet,
  setSharedTestRailgunWallet,
} from './shared.test';
import { TransactionRequest } from '@ethersproject/providers';
import { groth16 } from 'snarkjs';

const dbgRailgunSetup = debug('railgun:setup');

const dbgRailgunQuickstart = debug('railgun:quickstart');
dbgRailgunQuickstart.enabled = testConfig.showVerboseLogs;

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

  const { error } = startRailgunEngine(
    testWalletSource,
    db,
    shouldDebug,
    testArtifactStore,
    false, // useNativeArtifacts
    false, // skipMerkletreeScans
  );

  setLoggers(
    (msg: string) => dbgRailgunQuickstart(msg),
    (error: string | Error) => dbgRailgunQuickstart(error),
  );

  getProver().setSnarkJSGroth16(groth16 as Groth16);

  if (error) {
    throw new Error(error);
  }
};

export const loadLocalhostFallbackProviderForTests = async () => {
  const provider = getGanacheProvider();
  const chainId = (await provider.getNetwork()).chainId;
  const localhostProviderConfig: FallbackProviderJsonConfig = {
    chainId,
    providers: [
      {
        provider: testConfig.localhostRPC,
        priority: 1,
        weight: 2,
      },
    ],
  };

  dbgRailgunSetup(
    `Loading ganache provider for chain ${chainId} to RAILGUN Engine.`,
  );
  const { error } = await loadProvider(
    localhostProviderConfig,
    NetworkName.Ethereum,
    true, // shouldDebug
  );
  if (error) {
    throw new Error(error);
  }
};

export const createRailgunWalletForTests = async () => {
  const { railgunWalletInfo } = await createRailgunWallet(
    testConfig.encryptionKey,
    testConfig.railgunMnemonic,
    {},
  );
  if (!railgunWalletInfo) {
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
    BigNumber.from(10).pow(18).mul(10000000), // 1 MM approved
  );
  return wallet.sendTransaction(tx);
};

export const shieldAllTokensForTests = async (tokenAddresses: string[]) => {
  const wallet = getTestEthersWallet();

  dbgRailgunSetup('Approving all tokens for shielding...');

  for (let i = 0; i < tokenAddresses.length; i++) {
    await approveShield(wallet, tokenAddresses[i]);
  }

  dbgRailgunSetup('Shielding tokens... This may take 10-15 seconds.');

  const testRailgunWallet = getTestRailgunWallet();
  const railgunAddress = testRailgunWallet.getAddress();

  const oneThousand18Decimals = '1000000000000000000000';
  const erc20AmountRecipients: RailgunERC20AmountRecipient[] =
    tokenAddresses.map(tokenAddress => ({
      tokenAddress,
      amountString: BigNumber.from(oneThousand18Decimals).toHexString(), // 1000
      recipientAddress: railgunAddress,
    }));

  const shieldPrivateKey = getRandomBytes(32);
  const { serializedTransaction, error } = await populateShield(
    NetworkName.Ethereum,
    shieldPrivateKey,
    erc20AmountRecipients,
    [], // nftAmountRecipients
  );
  if (error) {
    throw new Error(`Error populating shield: ${error}`);
  }
  if (!serializedTransaction) {
    throw new Error('No populated shield');
  }

  const provider = getGanacheProvider();
  const chainId = (await provider.getNetwork()).chainId;
  const tx = deserializeTransaction(serializedTransaction, undefined, chainId);

  await trySendShieldTransaction(wallet, tx);

  dbgRailgunSetup('Shielded tokens.');
};

const trySendShieldTransaction = async (
  wallet: Wallet,
  transaction: TransactionRequest,
  retryCount = 0,
): Promise<void> => {
  try {
    await wallet.sendTransaction(transaction);
  } catch (err) {
    if (retryCount < 3) {
      await delay(500);
      return trySendShieldTransaction(wallet, transaction, retryCount + 1);
    }
    dbgRailgunSetup(err);
    throw new Error(`Could not send SHIELD transaction. See error output.`);
  }
};

export const waitForShieldedTokenBalances = async (
  tokenAddresses: string[],
) => {
  const onBalancesUpdate = (balancesEvent: RailgunBalancesEvent) => {
    dbgRailgunQuickstart('onBalancesUpdate', balancesEvent);
  };
  setOnBalanceUpdateCallback(onBalancesUpdate);

  dbgRailgunSetup('Scanning private balances and populating test.db...');

  const testRailgunWallet = getTestRailgunWallet();

  const tokenBalanceGetter = (
    tokenAddress: string,
  ): (() => Promise<BigNumber>) => {
    dbgRailgunSetup(`Polling for updated token balance... ${tokenAddress}`);
    return () =>
      balanceForERC20Token(
        testRailgunWallet,
        NetworkName.Ethereum,
        tokenAddress,
      );
  };

  await Promise.all(
    tokenAddresses.map(async tokenAddress => {
      const balance = await poll(
        tokenBalanceGetter(tokenAddress),
        balance => balance.gte('997500000000000000000'),
        100, // Delay in MS
        300, // Iterations - 30sec total
      );
      if (!balance) {
        throw new Error(`Could not find shielded balance for ${tokenAddress}`);
      }
    }),
  );

  dbgRailgunSetup('---');
  dbgRailgunSetup('Shielded token balances found. Test setup complete.');
  dbgRailgunSetup('---');
};
