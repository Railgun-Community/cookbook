import { NetworkName } from '@railgun-community/shared-models';
import { UniswapV2Fork } from '../../models/export-models';
import { PairDataWithRate } from '../../models/uni-v2-like';
import { UniV2LikeSubgraph } from '../../graph/uni-v2-like-subgraph';
import { CookbookDebug } from '../../utils/cookbook-debug';
import { Provider } from 'ethers';
import { UniV2LikeSubgraphCache } from '../../graph/graph-cache/uni-v2-like-subgraph-cache';

export const getAllLPPairsForTokenAddressesPerFork = (
  uniswapV2Fork: UniswapV2Fork,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<PairDataWithRate[]> => {
  try {
    return UniV2LikeSubgraph.getPairsForTokenAddresses(
      uniswapV2Fork,
      networkName,
      tokenAddresses,
    );
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    CookbookDebug.error(err);
    throw new Error('Failed to get LP pairs');
  }
};

export const getAllLPPairsForTokenAddresses = async (
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<PairDataWithRate[]> => {
  const allLPPairs = await Promise.all(
    Object.values(UniswapV2Fork).map(fork => {
      return getAllLPPairsForTokenAddressesPerFork(
        fork,
        networkName,
        tokenAddresses,
      );
    }),
  );
  return allLPPairs.flat();
};

export const getCachedLPPairsForTokenAddresses = (
  provider: Provider,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<PairDataWithRate[]> => {
  try {
    return UniV2LikeSubgraphCache.getCachedPairsForTokenAddresses(
      provider,
      networkName,
      tokenAddresses,
    );
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    CookbookDebug.error(err);
    throw new Error('Failed to get LP pairs');
  }
};

export const getLPPairsForTokenAddresses = async (
  provider: Provider,
  networkName: NetworkName,
  tokenAddresses: string[],
): Promise<PairDataWithRate[]> => {
  try {
    return await getCachedLPPairsForTokenAddresses(
      provider,
      networkName,
      tokenAddresses,
    );
  } catch (err) {
    return getAllLPPairsForTokenAddresses(networkName, tokenAddresses);
  }
};
