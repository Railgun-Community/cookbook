import ABI_ERC20 from './token/erc20.json';
import ABI_ERC721 from './token/erc721.json';
import ABI_RELAY_ADAPT from './adapt/RelayAdapt.json';
import ABI_UNI_V2_LIKE_FACTORY from './liquidity/UniV2LikeFactory.json';
import ABI_UNI_V2_LIKE_ROUTER from './liquidity/UniV2LikeRouter.json';
import ABI_UNI_V2_LIKE_PAIR from './liquidity/UniV2LikePair.json';
import ABI_BEEFY_VAULT_MERGED_V6V7 from './vault/beefy/BeefyVault-MergedV6V7.json';
import ABI_GMX_REWARD_ROUTER_V2 from './vault/gmx/RewardRouterV2.json';
import ABI_GMX_GLP_MANAGER from './vault/gmx/GlpManager.json';
import ABI_GMX_VAULT from './vault/gmx/Vault.json';
import ABI_ACCESS_CARD_ERC721 from './access-card/AccessCardERC721.json';
import ABI_ACCESS_CARD_OWNER_ACCOUNT from './access-card/AccessCardOwnerAccount.json';
import ABI_ACCESS_CARD_ACCOUNT_CREATOR from './access-card/AccessCardAccountCreator.json';

export const abi = {
  token: {
    erc20: ABI_ERC20,
    erc721: ABI_ERC721,
    accessCardERC721: ABI_ACCESS_CARD_ERC721,
  },
  accessCard: {
    erc721: ABI_ACCESS_CARD_ERC721,
    ownerAccount: ABI_ACCESS_CARD_OWNER_ACCOUNT,
    accountCreator: ABI_ACCESS_CARD_ACCOUNT_CREATOR,
  },
  adapt: {
    relay: ABI_RELAY_ADAPT,
  },
  liquidity: {
    uniV2LikeFactory: ABI_UNI_V2_LIKE_FACTORY,
    uniV2LikeRouter: ABI_UNI_V2_LIKE_ROUTER,
    uniV2LikePair: ABI_UNI_V2_LIKE_PAIR,
  },
  vault: {
    beefy: ABI_BEEFY_VAULT_MERGED_V6V7,
    gmx: {
      rewardRouterV2: ABI_GMX_REWARD_ROUTER_V2,
      glpManager: ABI_GMX_GLP_MANAGER,
      vault: ABI_GMX_VAULT,
    },
  },
} as const;
