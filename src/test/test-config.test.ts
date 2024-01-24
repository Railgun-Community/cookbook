import { NetworkName } from "@railgun-community/shared-models";

export let testConfig = {
  // Set env ETHEREUM_RPC to change default fork RPC.
  ethereumForkRPC: process.env.ETHEREUM_RPC ?? 'https://cloudflare-eth.com',

  showVerboseLogs: false,

  // Mock wallets for tests
  signerMnemonic: 'test test test test test test test test test test test junk',
  railgunMnemonic:
    'test test test test test test test test test test test junk',
  railgunMnemonic2:
    'nation page hawk lawn rescue slim cup tired clutch brand holiday genuine',
  encryptionKey:
    '0101010101010101010101010101010101010101010101010101010101010101',

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
    usdcWethSushiSwapV2LPToken: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
    // Vault tokens
    crvUSDCWBTCWETH: '0x7F86Bf177Dd4F3494b841a37e810A34dD56c829B',
    mooConvexTriCryptoUSDC: '0xD1BeaD7CadcCC6b6a715A6272c39F1EC54F6EC99',
  },

  contractsArbitrum: {
    proxy: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9',
    treasuryProxy: '0xE8A8B458BcD1Ececc6b6b58F80929b29cCecFF40',
    weth9: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    relayAdapt: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',

    // Standard tokens
    dai: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
  },
  contractsPolygon: {
    proxy: '0x19b620929f97b7b990801496c3b361ca5def8c71',
    treasuryProxy: '0xdca05161eE5b5FA6DF170191c88857E70FFB4094',
    wmatic: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
    relayAdapt: '0xc7FfA542736321A3dd69246d73987566a5486968',

    // Standard tokens
    dai: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    bnb: '0xA649325Aa7C5093d12D6F98EB4378deAe68CE23F',
    usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  },
  // OVERRIDES - override using test-config-overrides.ts

  // API Domain for a proxy server equipped with 0x nginx config that includes private API key.
  zeroXProxyApiDomain: process.env.ZERO_X_PROXY_API_DOMAIN ?? '',
  // API Key for 0x API.
  zeroXApiKey: process.env.ZERO_X_API_KEY ?? '',

  selectedNetwork: 'contractsEthereum' as ('contractsEthereum' | 'contractsArbitrum' | 'contractsPolygon'),
  poiNodeURL: process.env.POI_NODE_URL ?? '',
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
