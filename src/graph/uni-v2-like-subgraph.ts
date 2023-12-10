import { NetworkName, isDefined } from '@railgun-community/shared-models';
import { getMeshOptions, getSdk } from './graphql/.graphclient';
import { MeshInstance, getMesh } from '@graphql-mesh/runtime';
import { LiquidityV2Pool } from '../models/uni-v2-like';
import {
  calculatePairRateWith18Decimals,
  getLPPairTokenName,
  getLPPairTokenSymbol,
  getLPPoolName,
  getPairTokenDecimals,
} from '../utils/lp-pair';
import { UniswapV2Fork } from '../models/export-models';
import { CookbookDebug } from '../utils/cookbook-debug';
import { parseUnits } from 'ethers';

export class UniV2LikeSubgraph {
  private static meshes: Record<string, MeshInstance> = {};

  static subgraphSupportsUniV2Fork = (
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): boolean => {
    try {
      this.sourceNameForForkAndNetwork(uniswapV2Fork, networkName);
      return true;
    } catch {
      return false;
    }
  };

  static queryPairsForTokenAddresses = async (
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    tokenAddresses: string[],
    retryCount = 0,
  ): Promise<LiquidityV2Pool[]> => {
    try {
      const sdk = this.getBuiltGraphSDK(uniswapV2Fork, networkName);
      const tokenAddressesLowercase = tokenAddresses.map(address =>
        address.toLowerCase(),
      );

      const [{ pairs: pairsByTokensAB }, { pairs: pairsByLPToken }] =
        await Promise.all([
          sdk.PairsByTokensAB({ tokens: tokenAddressesLowercase }),
          sdk.PairsByLPToken({ tokens: tokenAddressesLowercase }),
        ]);

      const pairs = [...pairsByTokensAB, ...pairsByLPToken];

      const pairData: LiquidityV2Pool[] = pairs.map(pair => {
        const tokenDecimalsA = BigInt(pair.token0.decimals);
        const reserveA = parseUnits(pair.reserve0, tokenDecimalsA);
        const tokenDecimalsB = BigInt(pair.token1.decimals);
        const reserveB = parseUnits(pair.reserve1, tokenDecimalsB);
        const rateWith18Decimals = calculatePairRateWith18Decimals(
          reserveA,
          tokenDecimalsA,
          reserveB,
          tokenDecimalsB,
        );
        const tokenSymbolA = pair.token0.symbol;
        const tokenSymbolB = pair.token1.symbol;
        const liquidityV2Pool: LiquidityV2Pool = {
          name: getLPPoolName(uniswapV2Fork, tokenSymbolA, tokenSymbolB),
          uniswapV2Fork,
          tokenAddressA: pair.token0.id,
          tokenDecimalsA,
          tokenSymbolA,
          tokenAddressB: pair.token1.id,
          tokenDecimalsB,
          tokenSymbolB,
          pairAddress: pair.id,
          pairTokenName: getLPPairTokenName(
            uniswapV2Fork,
            tokenSymbolA,
            tokenSymbolB,
          ),
          pairTokenSymbol: getLPPairTokenSymbol(tokenSymbolA, tokenSymbolB),
          pairTokenDecimals: getPairTokenDecimals(),
          rateWith18Decimals,
        };
        return liquidityV2Pool;
      });

      return pairData;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      if (retryCount < 2) {
        return this.queryPairsForTokenAddresses(
          uniswapV2Fork,
          networkName,
          tokenAddresses,
          retryCount + 1,
        );
      }
      CookbookDebug.error(cause);
      throw new Error(
        'Could not get list of LP pairs. GraphQL request error.',
        { cause },
      );
    }
  };

  private static sourceNameForForkAndNetwork = (
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): string => {
    switch (uniswapV2Fork) {
      case UniswapV2Fork.Uniswap:
        if (networkName === NetworkName.Ethereum) {
          return 'uniswap-v2-ethereum';
        }
        throw new Error(
          'Uniswap V2 LP Subgraph is not supported on this network',
        );
      case UniswapV2Fork.PancakeSwap:
        if (networkName === NetworkName.BNBChain) {
          return 'pancakeswap-v2-bsc';
        }
        throw new Error(
          'PancakeSwap V2 LP Subgraph is not supported on this network',
        );
      case UniswapV2Fork.Quickswap:
        if (networkName === NetworkName.Polygon) {
          return 'quickswap-v2-polygon';
        }
        throw new Error(
          'Quickswap V2 LP Subgraph is not supported on this network',
        );
      case UniswapV2Fork.SushiSwap: {
        switch (networkName) {
          case NetworkName.Ethereum:
            return 'sushiswap-v2-ethereum';
          case NetworkName.Polygon:
            return 'sushiswap-v2-polygon';
          case NetworkName.BNBChain:
            return 'sushiswap-v2-bsc';
          case NetworkName.Arbitrum:
            return 'sushiswap-v2-arbitrum';
          case NetworkName.ArbitrumGoerli:
          case NetworkName.EthereumRopsten_DEPRECATED:
          case NetworkName.PolygonMumbai:
          case NetworkName.EthereumGoerli:
          case NetworkName.EthereumSepolia:
          case NetworkName.Hardhat:
            throw new Error(
              'Sushiswap V2 LP Subgraph is not supported on this network',
            );
        }
      }
    }
  };

  private static getBuiltGraphClient = async (
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): Promise<MeshInstance> => {
    const meshID = `${uniswapV2Fork}-${networkName}`;
    if (isDefined(this.meshes[meshID])) {
      return this.meshes[meshID];
    }
    const sourceName = this.sourceNameForForkAndNetwork(
      uniswapV2Fork,
      networkName,
    );
    const meshOptions = await getMeshOptions();
    const filteredSources = meshOptions.sources.filter(source => {
      return source.name === sourceName;
    });
    if (filteredSources.length !== 1) {
      throw new Error(
        `Expected exactly one source for Uni-Like V2 fork ${uniswapV2Fork}, network ${networkName}, found ${filteredSources.length}`,
      );
    }
    meshOptions.sources = [filteredSources[0]];
    const mesh = await getMesh(meshOptions);
    this.meshes[meshID] = mesh;
    const id = mesh.pubsub.subscribe('destroy', () => {
      mesh.pubsub.unsubscribe(id);
    });
    return mesh;
  };

  private static getBuiltGraphSDK = <TGlobalContext, TOperationContext>(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    globalContext?: TGlobalContext,
  ) => {
    const sdkRequester$ = this.getBuiltGraphClient(
      uniswapV2Fork,
      networkName,
    ).then(({ sdkRequesterFactory }) => sdkRequesterFactory(globalContext));
    return getSdk<TOperationContext, TGlobalContext>((...args) =>
      sdkRequester$.then(sdkRequester => sdkRequester(...args)),
    );
  };
}
