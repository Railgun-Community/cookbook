/**
 * Shared Morpho (Ethereum mainnet) addresses. The Blue singleton is reused by
 * the Stage-03 market recipes; the MetaMorpho vault registry lists a few
 * well-known ERC-4626 vaults usable directly and in fork tests.
 */
export const MORPHO_ADDRESSES = {
  // Immutable, admin-less Morpho Blue singleton.
  blue: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
} as const;

export type KnownMetaMorphoVault = {
  name: string;
  vaultAddress: string;
  assetAddress: string;
  assetDecimals: bigint;
};

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/**
 * Curated MetaMorpho vaults. Not exhaustive — the recipes query vault metadata
 * (asset, decimals) and ERC-4626 previews on-chain, so any MetaMorpho vault
 * address works without a registry entry.
 */
export const KNOWN_METAMORPHO_VAULTS: Record<string, KnownMetaMorphoVault> = {
  steakUSDC: {
    name: 'Steakhouse USDC',
    vaultAddress: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    assetAddress: USDC,
    assetDecimals: 6n,
  },
};
