import { NetworkName } from '@railgun-community/shared-models';
import { UniswapV2Fork } from '../../models/export-models';
import { LiquidityV2Pool } from '../../models/uni-v2-like';
import { UniV2LikeSubgraph } from '../../graph/uni-v2-like-subgraph';
import { CookbookDebug } from '../../utils/cookbook-debug';
import { Provider } from 'ethers';
import { UniV2LikeSubgraphCache } from '../../graph/graph-cache/uni-v2-like-subgraph-cache';

export const queryAllLPPairsForTokenAddressesPerFork = async (
  uniswapV2Fork: UniswapV2Fork,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<LiquidityV2Pool[]> => {
  try {
    return await UniV2LikeSubgraph.queryPairsForTokenAddresses(
      uniswapV2Fork,
      networkName,
      tokenAddresses,
    );
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Unexpected non-error thrown', { cause });
    }
    CookbookDebug.error(cause);
    throw new Error('Failed to query LP pairs for token addresses.', { cause });
  }
};

export const queryAllLPPairsForTokenAddresses = async (
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<LiquidityV2Pool[]> => {
  const allLPPairs = await Promise.all(
    Object.values(UniswapV2Fork).map(fork => {
      return queryAllLPPairsForTokenAddressesPerFork(
        fork,
        networkName,
        tokenAddresses,
      );
    }),
  );
  return allLPPairs.flat();
};

export const getCachedLPPairsForTokenAddresses = async (
  provider: Provider,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<LiquidityV2Pool[]> => {
  try {
    return await UniV2LikeSubgraphCache.getCachedPairsForTokenAddresses(
      provider,
      networkName,
      tokenAddresses,
    );
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Unexpected non-error thrown', { cause });
    }
    CookbookDebug.error(cause);
    throw new Error('Failed to get cached LP pairs for token addresses.', {
      cause,
    });
  }
};

export const getLPPairsForTokenAddresses = async (
  provider: Provider,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<LiquidityV2Pool[]> => {
  try {
    return await getCachedLPPairsForTokenAddresses(
      provider,
      networkName,
      tokenAddresses,
    );
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Unexpected non-error thrown', { cause });
    }
    CookbookDebug.error(cause);
    return queryAllLPPairsForTokenAddresses(networkName, tokenAddresses);
  }
};
