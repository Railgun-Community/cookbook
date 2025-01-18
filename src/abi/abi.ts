import ABI_ERC20 from './token/erc20.json';
import ABI_ERC721 from './token/erc721.json';
import ABI_RELAY_ADAPT from './adapt/RelayAdapt.json';
import ABI_UNI_V2_LIKE_FACTORY from './liquidity/UniV2LikeFactory.json';
import ABI_UNI_V2_LIKE_ROUTER from './liquidity/UniV2LikeRouter.json';
import ABI_UNI_V2_LIKE_PAIR from './liquidity/UniV2LikePair.json';
import ABI_BEEFY_VAULT_MERGED_V6V7 from './vault/beefy/BeefyVault-MergedV6V7.json';
import ABI_LIDO_STETH from './lido/LidoSTETH.json';
import ABI_LIDO_WSTETH from './lido/LidoWSTETH.json';

export const abi = {
  token: {
    erc20: ABI_ERC20,
    erc721: ABI_ERC721,
  },
  adapt: {
    relay: ABI_RELAY_ADAPT,
  },
  lido: {
    steth: ABI_LIDO_STETH,
    wsteth: ABI_LIDO_WSTETH,
  },
  liquidity: {
    uniV2LikeFactory: ABI_UNI_V2_LIKE_FACTORY,
    uniV2LikeRouter: ABI_UNI_V2_LIKE_ROUTER,
    uniV2LikePair: ABI_UNI_V2_LIKE_PAIR,
  },
  vault: {
    beefy: ABI_BEEFY_VAULT_MERGED_V6V7,
  },
} as const;
