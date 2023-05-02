import {
  createRailgunWalletForTests,
  loadLocalhostFallbackProviderForTests,
  shieldAllTokensForTests,
  startRailgunForTests,
  waitForShieldedTokenBalances,
} from './railgun-setup.test';
import { setupGanacheEthereumRPCAndWallets } from './ganache-setup.test';

before(async function run() {
  if (process.env.RUN_GANACHE_TESTS) {
    this.timeout(100000);
    await setupGanacheQuickstartTests();
  }
});

after(() => {
  // Uncomment to reset database and artifacts after each test run.
  // Not recommended, as balances will need to rescan.
  // removeTestFiles();
});

export const setupGanacheQuickstartTests = async () => {
  // Ganache forked Ethereum RPC setup
  await setupGanacheEthereumRPCAndWallets();

  // Quickstart setup
  startRailgunForTests();
  await loadLocalhostFallbackProviderForTests();

  // Wallet setup and initial shield
  const { id: railgunWalletID, railgunAddress } =
    await createRailgunWalletForTests();
  await shieldAllTokensForTests(railgunAddress);

  // Make sure shielded balances are updated
  await waitForShieldedTokenBalances(railgunWalletID);
};
