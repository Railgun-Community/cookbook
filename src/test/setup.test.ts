import {
  NetworkName,
  TXIDVersion,
  isDefined,
} from '@railgun-community/shared-models';
import {
  createRailgunWallet2ForTests,
  createRailgunWalletForTests,
  loadLocalhostFallbackProviderForTests,
  pollUntilUTXOMerkletreeScanned,
  removeTestDB,
  shieldAllTokensForTests,
  startRailgunForTests,
  waitForShieldedTokenBalances,
} from './railgun-setup.test';
import { ForkRPCType, setupTestRPCAndWallets } from './rpc-setup.test';
import { testConfig } from './test-config.test';
import { getForkTestNetworkName } from './common.test';

before(async function run() {
  if (isDefined(process.env.RUN_FORK_TESTS)) {
    this.timeout(3 * 60 * 1000); // 3 min timeout for setup.
    removeTestDB();
    await setupForkTests();
  }
});

after(() => {
  if (isDefined(process.env.RUN_FORK_TESTS)) {
    removeTestDB();
  }
});

const getTestERC20Addresses = (networkName: NetworkName): string[] => {
  switch (networkName) {
    case NetworkName.Ethereum:
      return [
        testConfig.contractsEthereum.weth9,
        testConfig.contractsEthereum.rail,
        testConfig.contractsEthereum.usdc,
        testConfig.contractsEthereum.usdcWethSushiSwapV2LPToken,
        testConfig.contractsEthereum.crvUSDCWBTCWETH,
        testConfig.contractsEthereum.mooConvexTriCryptoUSDC,
      ];
    case NetworkName.Arbitrum:
      return [testConfig.contractsArbitrum.dai];
    case NetworkName.BNBChain:
    case NetworkName.Polygon:
    case NetworkName.EthereumRopsten_DEPRECATED:
    case NetworkName.EthereumGoerli_DEPRECATED:
    case NetworkName.EthereumSepolia:
    case NetworkName.PolygonMumbai:
    case NetworkName.ArbitrumGoerli:
    case NetworkName.Hardhat:
      return [];
  }
};

const getSupportedNetworkNamesForTest = (): NetworkName[] => {
  return [NetworkName.Ethereum, NetworkName.Arbitrum];
};

export const setupForkTests = async () => {
  const networkName = getForkTestNetworkName();
  const txidVersion = TXIDVersion.V2_PoseidonMerkle;

  if (!Object.keys(NetworkName).includes(networkName)) {
    throw new Error(
      `Unrecognized network name, expected one of list: ${getSupportedNetworkNamesForTest().join(
        ', ',
      )}`,
    );
  }

  const tokenAddresses: string[] = getTestERC20Addresses(networkName);

  const forkRPCType = isDefined(process.env.USE_GANACHE)
    ? ForkRPCType.Ganache
    : isDefined(process.env.USE_HARDHAT)
    ? ForkRPCType.Hardhat
    : ForkRPCType.Anvil;

  // Ganache forked Ethereum RPC setup
  await setupTestRPCAndWallets(forkRPCType, networkName, tokenAddresses);

  // Quickstart setup
  await startRailgunForTests();

  await loadLocalhostFallbackProviderForTests(networkName);

  await pollUntilUTXOMerkletreeScanned();

  // Set up primary wallet
  await createRailgunWalletForTests();

  // Set up secondary wallets
  await createRailgunWallet2ForTests();

  // Shield tokens for tests
  await shieldAllTokensForTests(networkName, tokenAddresses);

  // Make sure shielded balances are updated
  await waitForShieldedTokenBalances(txidVersion, networkName, tokenAddresses);
};
