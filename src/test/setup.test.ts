import {
  Chain,
  NetworkName,
  TXIDVersion,
  isDefined,
} from '@railgun-community/shared-models';
import { refreshBalances } from '@railgun-community/wallet';
import {
  clampQuickSyncToBlock,
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
import { getTestProvider } from './shared.test';

before(async function run() {
  if (isDefined(process.env.RUN_FORK_TESTS)) {
    // Fork setup is a genuine ~10-15 min: a full merkletree rescan from RAILGUN
    // genesis (test.db is wiped just below), then one shield per token in the
    // list — each a proof generation. Adding the three f(x) tokens took that
    // list from 8 to 11 and pushed a previously-passing setup past the old
    // 10-minute cap, which then reads as a mysterious `before all` timeout
    // several seconds AFTER "Test setup complete" is logged.
    //
    // Use FORK_TEST_TOKENS=minimal to shield only WETH when the target recipe
    // does not need the rest — that is the real lever on setup cost.
    this.timeout(20 * 60 * 1000);
    removeTestDB();
    await setupForkTests();
  }
});

after(() => {
  if (isDefined(process.env.RUN_FORK_TESTS)) {
    removeTestDB();
  }
});

/**
 * Set FORK_TEST_TOKENS=minimal to shield only the base wrapped token.
 *
 * Fork setup shields every token in the list, and each shield is a proof
 * generation — the dominant memory and time cost of `before()`. A run targeting
 * a single recipe that only needs WETH pays for seven unrelated shields
 * otherwise, which is the difference between fitting in a memory-constrained
 * container and being OOM-killed during setup.
 *
 * Unset (the default) keeps the full list, so existing fork runs are unchanged.
 */
const useMinimalTokenSet = (): boolean =>
  process.env.FORK_TEST_TOKENS === 'minimal';

const getTestERC20Addresses = (networkName: NetworkName): string[] => {
  if (useMinimalTokenSet()) {
    switch (networkName) {
      case NetworkName.Ethereum:
        return [testConfig.contractsEthereum.weth9];
      case NetworkName.Arbitrum:
        return [testConfig.contractsArbitrum.dai];
      default:
        return [];
    }
  }
  switch (networkName) {
    case NetworkName.Ethereum:
      return [
        testConfig.contractsEthereum.weth9,
        testConfig.contractsEthereum.rail,
        testConfig.contractsEthereum.usdc,
        testConfig.contractsEthereum.conicEthLPToken,
        testConfig.contractsEthereum.crvUSDCWBTCWETH,
        testConfig.contractsEthereum.mooConvexTriCryptoUSDC,
        testConfig.contractsEthereum.steakUSDCVault,
        testConfig.contractsEthereum.steakPrimeUSDCVaultV2,
        // f(x) fxMINT collateral and debt tokens. Needed by every fx fork test:
        // no fx leg is expressible without one of these shielded, which is why
        // the fx family has never had an executed-batch test.
        testConfig.contractsEthereum.wstETH,
        testConfig.contractsEthereum.fxUSD,
        testConfig.contractsEthereum.wbtc,
      ];
    case NetworkName.Arbitrum:
      return [testConfig.contractsArbitrum.dai];
    case NetworkName.BNBChain:
    case NetworkName.Polygon:
    case NetworkName.EthereumSepolia:
    case NetworkName.Hardhat:
    case NetworkName.PolygonAmoy:
    case NetworkName.EthereumRopsten_DEPRECATED:
    case NetworkName.EthereumGoerli_DEPRECATED:
    case NetworkName.ArbitrumGoerli_DEPRECATED:
    case NetworkName.PolygonMumbai_DEPRECATED:
      return [];
  }
};

const getSupportedNetworkNamesForTest = (): NetworkName[] => {
  return [NetworkName.Ethereum, NetworkName.Arbitrum];
};

export const setupForkTests = async () => {
  try {
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
    const testChain: Chain = { id: 1, type: 0 };

    const forkRPCType = isDefined(process.env.USE_GANACHE)
      ? ForkRPCType.Ganache
      : isDefined(process.env.USE_HARDHAT)
        ? ForkRPCType.Hardhat
        : ForkRPCType.Anvil;

    // Ganache forked Ethereum RPC setup
    await setupTestRPCAndWallets(forkRPCType, networkName, tokenAddresses);

    // Bound quicksync to the fork's own block BEFORE the engine starts.
    // The indexer runs ahead of a pinned fork (and can overtake even a fork
    // started at head, since a scan takes minutes), and any commitment it has
    // that the fork does not fails merkleroot validation. See
    // clampQuickSyncToBlock.
    const forkBlockNumber = await getTestProvider().getBlockNumber();
    clampQuickSyncToBlock(forkBlockNumber);

    // Quickstart setup
    await startRailgunForTests();

    await loadLocalhostFallbackProviderForTests(networkName);

    void refreshBalances(testChain, undefined);

    await pollUntilUTXOMerkletreeScanned();
    // Set up primary wallet
    await createRailgunWalletForTests();
    // Set up secondary wallets
    await createRailgunWallet2ForTests();
    // Shield tokens for tests
    await shieldAllTokensForTests(networkName, tokenAddresses);

    // Make sure shielded balances are updated
    await waitForShieldedTokenBalances(txidVersion, networkName, tokenAddresses);
  } catch (error) {
    console.error("Setup Fork tests error: ", error);
    throw error;
  }
};
