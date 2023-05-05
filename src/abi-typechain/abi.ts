import ABI_ERC20 from './token/erc20.json';
import ABI_ERC721 from './token/erc721.json';

import ABI_DAI_STABLECOIN from './stablecoin/dai.json';

import ABI_RELAY_ADAPT from './adapt/RelayAdapt.json';

export const abi = {
  token: {
    erc20: ABI_ERC20,
    erc721: ABI_ERC721,
  },
  stablecoin: {
    dai: ABI_DAI_STABLECOIN,
  },
  adapt: {
    relay: ABI_RELAY_ADAPT,
  },
} as const;
