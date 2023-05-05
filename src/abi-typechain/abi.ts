import ABI_ERC20 from './token/erc20.json';
import ABI_ERC721 from './token/erc721.json';
import ABI_RELAY_ADAPT from './adapt/RelayAdapt.json';
import ABI_BEEFY_VAULT_V7 from './vault/beefy/BeefyVaultV7.json';

export const abi = {
  token: {
    erc20: ABI_ERC20,
    erc721: ABI_ERC721,
  },
  adapt: {
    relay: ABI_RELAY_ADAPT,
  },
  vault: {
    beefy: ABI_BEEFY_VAULT_V7,
  },
} as const;
