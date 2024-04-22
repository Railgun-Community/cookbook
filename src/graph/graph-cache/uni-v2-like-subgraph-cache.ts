import { NetworkName } from '@railgun-community/shared-models';
import UNI_V2_ETH_PAIRS from './UNI-V2-ETH-PAIRS.json';
import SUSHI_V2_ETH_PAIRS from './SUSHI-V2-ETH-PAIRS.json';
import SUSHI_V2_POLYGON_PAIRS from './SUSHI-V2-POLYGON-PAIRS.json';
import SUSHI_V2_BSC_PAIRS from './SUSHI-V2-BSC-PAIRS.json';
import SUSHI_V2_ARBITRUM_PAIRS from './SUSHI-V2-ARBITRUM-PAIRS.json';
import PANCAKE_V2_BSC_PAIRS from './PANCAKE-V2-BSC-PAIRS.json';
import QUICK_V2_POLYGON_PAIRS from './QUICK-V2-POLYGON-PAIRS.json';
import { compareTokenAddresses } from '../../utils';
import { LiquidityV2Pool, RecipeERC20Info, UniswapV2Fork } from '../../models';
import { UniV2LikeSDK } from '../../api/uni-v2-like/uni-v2-like-sdk';
import { Provider } from 'ethers';
import {
  getLPPairTokenName,
  getLPPairTokenSymbol,
  getLPPoolName,
  getPairTokenDecimals,
} from '../../utils/lp-pair';

type LPCachedToken = {
  id: string;
  symbol: string;
  decimals: string;
};

type LPCachedListItem = {
  id: string;
  token0: LPCachedToken;
  token1: LPCachedToken;
};

type LPCachedListItemWithFork = LPCachedListItem & {
  uniswapV2Fork: UniswapV2Fork;
};

export class UniV2LikeSubgraphCache {
  static async getCachedPairsForTokenAddresses(
    provider: Provider,
    networkName: NetworkName,
    tokenAddresses: string[],
  ): Promise<LiquidityV2Pool[]> {
    const lpCachedList: LPCachedListItemWithFork[] =
      UniV2LikeSubgraphCache.getCachedLPListForNetwork(networkName);

    const filtered = lpCachedList.filter(({ id, token0, token1 }) => {
      return (
        // Token A + B are both in list
        (compareTokenAddresses(tokenAddresses, token0.id) &&
          compareTokenAddresses(tokenAddresses, token1.id)) ||
        // LP token is in list
        compareTokenAddresses(tokenAddresses, id)
      );
    });

    return Promise.all(
      filtered.map(async ({ id, uniswapV2Fork, token0, token1 }) => {
        const erc20InfoA: RecipeERC20Info = {
          tokenAddress: token0.id,
          decimals: BigInt(token0.decimals),
        };
        const erc20InfoB: RecipeERC20Info = {
          tokenAddress: token1.id,
          decimals: BigInt(token1.decimals),
        };
        const rateWith18Decimals = await UniV2LikeSDK.getPairRateWith18Decimals(
          uniswapV2Fork,
          networkName,
          provider,
          erc20InfoA,
          erc20InfoB,
        );

        const pairData: LiquidityV2Pool = {
          name: getLPPoolName(uniswapV2Fork, token0.symbol, token1.symbol),
          uniswapV2Fork: uniswapV2Fork,
          tokenAddressA: erc20InfoA.tokenAddress,
          tokenSymbolA: token0.symbol,
          tokenDecimalsA: erc20InfoA.decimals,
          tokenAddressB: erc20InfoB.tokenAddress,
          tokenDecimalsB: erc20InfoB.decimals,
          tokenSymbolB: token1.symbol,
          pairAddress: id,
          pairTokenName: getLPPairTokenName(
            uniswapV2Fork,
            token0.symbol,
            token1.symbol,
          ),
          pairTokenSymbol: getLPPairTokenSymbol(token0.symbol, token1.symbol),
          pairTokenDecimals: getPairTokenDecimals(),
          rateWith18Decimals,
        };
        return pairData;
      }),
    );
  }

  private static getCachedLPListForNetwork(
    networkName: NetworkName,
  ): LPCachedListItemWithFork[] {
    switch (networkName) {
      case NetworkName.Ethereum:
        return [
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            UNI_V2_ETH_PAIRS,
            UniswapV2Fork.Uniswap,
          ),
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            SUSHI_V2_ETH_PAIRS,
            UniswapV2Fork.SushiSwap,
          ),
        ];
      case NetworkName.BNBChain:
        return [
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            SUSHI_V2_BSC_PAIRS,
            UniswapV2Fork.SushiSwap,
          ),
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            PANCAKE_V2_BSC_PAIRS,
            UniswapV2Fork.PancakeSwap,
          ),
        ];
      case NetworkName.Polygon:
        return [
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            SUSHI_V2_POLYGON_PAIRS,
            UniswapV2Fork.SushiSwap,
          ),
          ...UniV2LikeSubgraphCache.mapItemsToFork(
            QUICK_V2_POLYGON_PAIRS,
            UniswapV2Fork.Quickswap,
          ),
        ];
      case NetworkName.Arbitrum:
        return UniV2LikeSubgraphCache.mapItemsToFork(
          SUSHI_V2_ARBITRUM_PAIRS,
          UniswapV2Fork.SushiSwap,
        );
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli_DEPRECATED:
      case NetworkName.EthereumSepolia:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
        return [];
    }
  }

  private static mapItemsToFork(
    items: LPCachedListItem[],
    uniswapV2Fork: UniswapV2Fork,
  ): LPCachedListItemWithFork[] {
    return items.map(item => ({
      ...item,
      uniswapV2Fork,
    }));
  }
}
