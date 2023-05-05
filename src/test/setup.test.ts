import {
  createRailgunWalletForTests,
  loadLocalhostFallbackProviderForTests,
  removeTestDB,
  shieldAllTokensForTests,
  startRailgunForTests,
  waitForShieldedTokenBalances,
} from './railgun-setup.test';
import { setupGanacheEthereumRPCAndWallets } from './ganache-setup.test';
import { ganacheConfig } from './ganache-config.test';

before(async function run() {
  if (process.env.RUN_GANACHE_TESTS) {
    this.timeout(2 * 60 * 1000); // 2 min timeout for setup.
    removeTestDB();
    await setupGanacheQuickstartTests();
  }
});

after(() => {
  if (process.env.RUN_GANACHE_TESTS) {
    removeTestDB();
  }
});

export const setupGanacheQuickstartTests = async () => {
  const tokenAddresses: string[] = [
    // ganacheConfig.contractsEthereum.weth9,
    // ganacheConfig.contractsEthereum.dai,
    // ganacheConfig.contractsEthereum.rail,
    // ganacheConfig.contractsEthereum.crvCRVETH,
    ganacheConfig.contractsEthereum.crvCRVETHVaultToken,
  ];

  // Ganache forked Ethereum RPC setup
  await setupGanacheEthereumRPCAndWallets(tokenAddresses);

  // Quickstart setup
  startRailgunForTests();
  await loadLocalhostFallbackProviderForTests();

  // Wallet setup and initial shield
  await createRailgunWalletForTests();
  await shieldAllTokensForTests(tokenAddresses);

  // Make sure shielded balances are updated
  await waitForShieldedTokenBalances(tokenAddresses);
};
