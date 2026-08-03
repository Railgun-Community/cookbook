import 'dotenv/config'
import { isDefined } from '@railgun-community/shared-models';

export let testConfig = {
  // Set env ETHEREUM_RPC to change default fork RPC.
  ethereumForkRPC: process.env.ETHEREUM_RPC ?? 'https://cloudflare-eth.com',

  // Block to pin the fork to. Leave UNSET (the default) unless you know the
  // constraint below — unset means "fork at head", which is what works.
  //
  // Two interacting facts:
  //
  //  1. `anvil_reset` re-forks from whatever config it is handed. Handing it
  //     `{}` silently drops the `--fork-block-number` anvil was started with.
  //     So the fork config has to be restated on reset, or the fork moves.
  //
  //  2. `quickSyncEventsGraphV2` takes a STARTING block and no end bound, so it
  //     always returns commitments up to the indexer's head. The engine then
  //     validates the reconstructed tree against the FORK's on-chain root.
  //
  // Together: pinning the fork BEHIND the indexer's head feeds the engine
  // commitments that do not exist in the fork's state yet, and the scan dies
  // with `Invalid merkleroot`. Observed exactly — fork pinned at 25_676_000
  // against a Subsquid head of 25_676_934 failed at tree 3 index 54260, which
  // is precisely the indexer's head commitment.
  //
  // So a pin is only valid if it is >= the indexer's head, and the indexer runs
  // ~45 blocks behind mainnet. Reproducing a measurement therefore means
  // recording the block the fork actually landed on, not pinning an old one.
  forkBlockNumber: isDefined(process.env.FORK_BLOCK)
    ? Number(process.env.FORK_BLOCK)
    : undefined,

  showVerboseLogs: false,

  // Mock wallets for tests. The first two are the canonical public
  // hardhat/anvil development mnemonic and the last is a dummy repeating key —
  // no funds, and unchanged since they were first committed. Marked so the
  // secret gate stops flagging this file every time an unrelated field near
  // them is edited.
  signerMnemonic: 'test test test test test test test test test test test junk', // pragma: allowlist secret
  railgunMnemonic:
    'test test test test test test test test test test test junk', // pragma: allowlist secret
  railgunMnemonic2:
    'nation page hawk lawn rescue slim cup tired clutch brand holiday genuine', // pragma: allowlist secret
  encryptionKey:
    '0101010101010101010101010101010101010101010101010101010101010101', // pragma: allowlist secret

  contractsEthereum: {
    proxy: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9',
    treasuryProxy: '0xE8A8B458BcD1Ececc6b6b58F80929b29cCecFF40',
    weth9: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    relayAdapt: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',

    // WARNING: Be careful adding tokens to this list.
    // Each new token will increase the setup time for tests.
    // Standard tokens
    rail: '0xe76C6c83af64e4C60245D8C7dE953DF673a7A33D',
    usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    // LP tokens
    // Public LP token contract address. The secret scanner's keyword rule reads
    // the trailing "Token:" as a credential prefix; it is not one.
    conicEthLPToken: '0x58649Ec8adD732ea710731b5Cb37c99529A394d3', // pragma: allowlist secret
    // Vault tokens
    crvUSDCWBTCWETH: '0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B',
    mooConvexTriCryptoUSDC: '0xD1BeaD7CadcCC6b6a715A6272c39F1EC54F6EC99',
    // MetaMorpho ERC-4626 vault (Steakhouse USDC), asset = USDC.
    steakUSDCVault: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    // Morpho Vault V2 (Steakhouse Prime USDC), asset = USDC.
    steakPrimeUSDCVaultV2: '0xbeef088055857739C12CD3765F20b7679Def0f51',
    // f(x) fxMINT. All three are needed to exercise a pool from either side:
    // a long supplies wstETH/WBTC collateral and repays fxUSD debt; a short
    // supplies fxUSD collateral and repays wstETH/WBTC debt. Mirrors
    // FX_ADDRESSES in src/steps/borrow/fx/fx-mint-util.ts.
    wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    fxUSD: '0x085780639CC2cACd35E474e71f4d000e2405d8f6',
    wbtc: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  },

  contractsArbitrum: {
    proxy: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9',
    treasuryProxy: '0xE8A8B458BcD1Ececc6b6b58F80929b29cCecFF40',
    weth9: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    relayAdapt: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',

    // Standard tokens
    dai: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
  },

  // OVERRIDES - override using test-config-overrides.ts

  // API Domain for a proxy server equipped with 0x nginx config that includes private API key.
  zeroXProxyApiDomain: process.env.ZERO_X_PROXY_API_DOMAIN ?? '',
  // API Key for 0x API.
  zeroXApiKey: process.env.ZERO_X_API_KEY ?? '',
};

try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, global-require, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
  const overrides = require('./test-config-overrides.test').default;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  testConfig = { ...testConfig, ...overrides };
  // eslint-disable-next-line no-empty
} catch {
  // eslint-disable-next-line no-console
  console.error('Could not load test-config-overrides.');
}
