import {
  ArtifactStore,
  balanceForERC20Token,
  createRailgunWallet,
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
  RailgunWalletInfo,
  deserializeTransaction,
  poll,
} from '@railgun-community/shared-models';
import { ganacheConfig } from './ganache-config.test';
import { BigNumber, Wallet } from 'ethers';
import { ganacheEthersProvider } from './ganache-setup.test';
import { debug } from 'debug';

const dbgRailgunEngine = debug('railgun:engine');
const dbgRailgunSetup = debug('railgun:setup');

const ENGINE_TEST_DB = 'test.db';
const db = new LevelDOWN(ENGINE_TEST_DB);

export const removeTestFiles = () => {
  const { warn } = console;
  fs.rm(ENGINE_TEST_DB, { recursive: true }, () => {
    warn('Error removing test db.');
  });
  fs.rm('artifacts-v2.1', { recursive: true }, () => {
    // Note: expect this error when we aren't running artifact download tests.
    warn('Error removing test artifacts.');
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
    (msg: string) => dbgRailgunEngine(msg),
    (error: string | Error) => dbgRailgunEngine(error),
  );

  if (error) {
    throw new Error(error);
  }
};

const localhostProviderConfig: FallbackProviderJsonConfig = {
  chainId: 31337,
  providers: [
    {
      provider: ganacheConfig.ganacheLocalhostRPC,
      priority: 1,
      weight: 2,
    },
  ],
};

export const loadLocalhostFallbackProviderForTests = async () => {
  dbgRailgunSetup('Loading ganache provider to RAILGUN Engine.');
  const { error } = await loadProvider(
    localhostProviderConfig,
    NetworkName.Ethereum,
    false, // shouldDebug
  );
  if (error) {
    throw new Error(error);
  }
};

export const createRailgunWalletForTests =
  async (): Promise<RailgunWalletInfo> => {
    const { railgunWalletInfo } = await createRailgunWallet(
      ganacheConfig.encryptionKey,
      ganacheConfig.mnemonic,
      {},
    );
    if (!railgunWalletInfo) {
      throw new Error('Error creating Railgun wallet.');
    }
    dbgRailgunSetup('RAILGUN wallet created.');
    return railgunWalletInfo;
  };

export const shieldAllTokensForTests = async (railgunAddress: string) => {
  dbgRailgunSetup('Shielding WETH, DAI, and RAIL tokens...');

  const oneThousand18Decimals = '1000000000000000000000';
  const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
    {
      tokenAddress: ganacheConfig.contractsEthereum.weth9,
      amountString: oneThousand18Decimals, // 1000
      recipientAddress: railgunAddress,
    },
    {
      tokenAddress: ganacheConfig.contractsEthereum.dai,
      amountString: oneThousand18Decimals, // 1000
      recipientAddress: railgunAddress,
    },
    {
      tokenAddress: ganacheConfig.contractsEthereum.rail,
      amountString: oneThousand18Decimals, // 1000
      recipientAddress: railgunAddress,
    },
  ];

  const shieldPrivateKey = getRandomBytes(32);
  const { serializedTransaction, error } = await populateShield(
    NetworkName.Ethereum,
    shieldPrivateKey,
    erc20AmountRecipients,
    [], // nftAmountRecipients
  );
  if (error) {
    throw new Error(error);
  }
  if (!serializedTransaction) {
    throw new Error('No populated shield');
  }

  if (!ganacheEthersProvider) {
    throw new Error('No ganache ethers provider');
  }
  const wallet = Wallet.fromMnemonic(ganacheConfig.mnemonic);
  const chainId = 1;
  const populatedTransaction = deserializeTransaction(
    serializedTransaction,
    undefined,
    chainId,
  );
  const signedTransaction = wallet.signTransaction(populatedTransaction);
  await ganacheEthersProvider.sendTransaction(signedTransaction);

  dbgRailgunSetup('Shielded WETH, DAI, and RAIL tokens.');
};

export const waitForShieldedTokenBalances = async (railgunWalletID: string) => {
  const onBalancesUpdate = (balancesEvent: RailgunBalancesEvent) => {
    dbgRailgunSetup('onBalancesUpdate', balancesEvent);
  };
  setOnBalanceUpdateCallback(onBalancesUpdate);

  dbgRailgunSetup(
    'Scanning private balances and populating test.db... This may take a while on the first test run.',
  );
  const wallet = walletForID(railgunWalletID);

  const tokenBalanceGetter = (
    tokenAddress: string,
  ): (() => Promise<Optional<BigNumber>>) => {
    dbgRailgunSetup(`Polling for updated token balance... ${tokenAddress}`);
    return () =>
      balanceForERC20Token(wallet, NetworkName.Ethereum, tokenAddress);
  };

  // Wait for initial balance update - WETH.
  await poll(
    tokenBalanceGetter(ganacheConfig.contractsEthereum.weth9),
    balance => (balance ? balance.gte('997500000000000000000') : false),
    1000, // Delay in MS
    100, // Iterations
  );

  // Make sure other tokens have balances.
  await poll(
    tokenBalanceGetter(ganacheConfig.contractsEthereum.dai),
    balance => (balance ? balance.gte('997500000000000000000') : false),
    100, // Delay in MS
    5, // Iterations
  );
  await poll(
    tokenBalanceGetter(ganacheConfig.contractsEthereum.rail),
    balance => (balance ? balance.gte('997500000000000000000') : false),
    100, // Delay in MS
    5, // Iterations
  );
};
