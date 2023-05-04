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
import { ganacheConfig } from './ganache-config.test';
import { BigNumber, Wallet } from 'ethers';
import { debug } from 'debug';
import { ERC20Contract } from '../contract/token/erc20-contract';
import {
  ganacheEthersProvider,
  getGanacheProvider,
  getTestEthersWallet,
  getTestRailgunWallet,
  setSharedTestRailgunWallet,
} from './shared.test';
import { TransactionRequest } from '@ethersproject/providers';
import { groth16 } from 'snarkjs';

const dbgRailgunSetup = debug('railgun:setup');

const dbgRailgunQuickstart = debug('railgun:quickstart');
dbgRailgunQuickstart.enabled = ganacheConfig.showVerboseLogs;

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
        provider: ganacheConfig.ganacheLocalhostRPC,
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
    ganacheConfig.encryptionKey,
    ganacheConfig.railgunMnemonic,
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
  const token = new ERC20Contract(tokenAddress, ganacheEthersProvider);
  const tx = await token.createSpenderApproval(
    ganacheConfig.contractsEthereum.proxy,
    BigNumber.from(10).pow(18).mul(10000000), // 1 MM approved
  );
  return wallet.sendTransaction(tx);
};

export const shieldAllTokensForTests = async () => {
  const wallet = getTestEthersWallet();

  dbgRailgunSetup('Approving WETH, DAI, and RAIL tokens for shielding...');

  await approveShield(wallet, ganacheConfig.contractsEthereum.weth9);
  await approveShield(wallet, ganacheConfig.contractsEthereum.dai);
  await approveShield(wallet, ganacheConfig.contractsEthereum.rail);

  dbgRailgunSetup(
    'Shielding WETH, DAI, and RAIL tokens... This may take 10-15 seconds.',
  );

  const testRailgunWallet = getTestRailgunWallet();
  const railgunAddress = testRailgunWallet.getAddress();

  const oneThousand18Decimals = '1000000000000000000000';
  const erc20AmountRecipients: RailgunERC20AmountRecipient[] = [
    {
      tokenAddress: ganacheConfig.contractsEthereum.weth9,
      amountString: BigNumber.from(oneThousand18Decimals).toHexString(), // 1000
      recipientAddress: railgunAddress,
    },
    {
      tokenAddress: ganacheConfig.contractsEthereum.dai,
      amountString: BigNumber.from(oneThousand18Decimals).toHexString(), // 1000
      recipientAddress: railgunAddress,
    },
    {
      tokenAddress: ganacheConfig.contractsEthereum.rail,
      amountString: BigNumber.from(oneThousand18Decimals).toHexString(), // 1000
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
    throw new Error(`Error populating shield: ${error}`);
  }
  if (!serializedTransaction) {
    throw new Error('No populated shield');
  }

  const provider = getGanacheProvider();
  const chainId = (await provider.getNetwork()).chainId;
  const tx = deserializeTransaction(serializedTransaction, undefined, chainId);

  await trySendShieldTransaction(wallet, tx);

  dbgRailgunSetup('Shielded WETH, DAI, and RAIL tokens.');
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

export const waitForShieldedTokenBalances = async () => {
  const onBalancesUpdate = (balancesEvent: RailgunBalancesEvent) => {
    dbgRailgunQuickstart('onBalancesUpdate', balancesEvent);
  };
  setOnBalanceUpdateCallback(onBalancesUpdate);

  dbgRailgunSetup('Scanning private balances and populating test.db...');

  const testRailgunWallet = getTestRailgunWallet();

  const tokenBalanceGetter = (
    tokenAddress: string,
  ): (() => Promise<Optional<BigNumber>>) => {
    dbgRailgunSetup(`Polling for updated token balance... ${tokenAddress}`);
    return () =>
      balanceForERC20Token(
        testRailgunWallet,
        NetworkName.Ethereum,
        tokenAddress,
      );
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

  dbgRailgunSetup('---');
  dbgRailgunSetup('Shielded token balances found. Test setup complete.');
  dbgRailgunSetup('---');
};
