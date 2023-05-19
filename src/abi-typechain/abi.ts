import ABI_ERC20 from './token/erc20.json';
import ABI_ERC721 from './token/erc721.json';
import ABI_RELAY_ADAPT from './adapt/RelayAdapt.json';
import ABI_UNI_V2_LIKE_FACTORY from './liquidity/UniV2LikeFactory.json';
import ABI_UNI_V2_LIKE_ROUTER from './liquidity/UniV2LikeRouter.json';
import ABI_UNI_V2_LIKE_PAIR from './liquidity/UniV2LikePair.json';
import ABI_BEEFY_VAULT_MERGED_V6V7 from './vault/beefy/BeefyVault-MergedV6V7.json';
import ABI_GMX_REWARD_TRACKER from './vault/gmx/RewardTracker.json';
import ABI_GMX_REWARD_ROUTER from './vault/gmx/RewardRouter.json';
import ABI_GMX_STAKED_GLP from './vault/gmx/StakedGlp.json';

export const abi = {
  token: {
    erc20: ABI_ERC20,
    erc721: ABI_ERC721,
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
      rewardTracker: ABI_GMX_REWARD_TRACKER,
      rewardRouter: ABI_GMX_REWARD_ROUTER,
      stakedGlp: ABI_GMX_STAKED_GLP,
    },
  },
} as const;
