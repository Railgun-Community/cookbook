import {
  createRailgunWalletForTests,
  loadLocalhostFallbackProviderForTests,
  removeTestDB,
  shieldAllTokensForTests,
  startRailgunForTests,
  waitForShieldedTokenBalances,
} from './railgun-setup.test';
import { ForkRPCType, setupTestEthereumRPCAndWallets } from './rpc-setup.test';
import { testConfig } from './test-config.test';

before(async function run() {
  if (process.env.RUN_FORK_TESTS) {
    this.timeout(2 * 60 * 1000); // 2 min timeout for setup.
    removeTestDB();
    await setupGanacheQuickstartTests();
  }
});

after(() => {
  if (process.env.RUN_FORK_TESTS) {
    removeTestDB();
  }
});

export const setupGanacheQuickstartTests = async () => {
  const tokenAddresses: string[] = [
    testConfig.contractsEthereum.weth9,
    testConfig.contractsEthereum.rail,
    testConfig.contractsEthereum.usdc,
    testConfig.contractsEthereum.usdcWethSushiswapV2LPToken,
    testConfig.contractsEthereum.crvCRVETH,
    testConfig.contractsEthereum.crvCRVETHVaultToken,
  ];

  const forkRPCType = process.env.USE_GANACHE
    ? ForkRPCType.Ganache
    : ForkRPCType.Anvil;

  // Ganache forked Ethereum RPC setup
  await setupTestEthereumRPCAndWallets(forkRPCType, tokenAddresses);

  // Quickstart setup
  startRailgunForTests();
  await loadLocalhostFallbackProviderForTests();

  // Wallet setup and initial shield
  await createRailgunWalletForTests();
  await shieldAllTokensForTests(tokenAddresses);

  // Make sure shielded balances are updated
  await waitForShieldedTokenBalances(tokenAddresses);
};
