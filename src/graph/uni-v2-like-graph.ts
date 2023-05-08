import { NetworkName } from '@railgun-community/shared-models';
import { getMeshOptions, getSdk } from './graphql/.graphclient';
import { MeshInstance, getMesh } from '@graphql-mesh/runtime';
import { PairDataWithRate } from '../models/uni-v2-like';
import { parseFixed } from '@ethersproject/bignumber';
import { calculatePairRateWith18Decimals } from '../utils/pair-rate';
import { UniswapV2Fork } from '../models/export-models';

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

  static getPairsForTokenAddresses = async (
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    tokenAddresses: string[],
  ): Promise<PairDataWithRate[]> => {
    const sdk = this.getBuiltGraphSDK(uniswapV2Fork, networkName);
    const tokenAddressesLowercase = tokenAddresses.map(address =>
      address.toLowerCase(),
    );

    const { pairs } = await sdk.Pairs({ tokens: tokenAddressesLowercase });

    const pairData: PairDataWithRate[] = pairs.map(pair => {
      const tokenDecimalsA = Number(pair.token0.decimals);
      const reserveA = parseFixed(pair.reserve0, tokenDecimalsA);
      const tokenDecimalsB = Number(pair.token1.decimals);
      const reserveB = parseFixed(pair.reserve1, tokenDecimalsB);
      const rateWith18Decimals = calculatePairRateWith18Decimals(
        reserveA,
        tokenDecimalsA,
        reserveB,
        tokenDecimalsB,
      );
      const pairDataWithRate: PairDataWithRate = {
        pairAddress: pair.id,
        tokenAddressA: pair.token0.id,
        tokenDecimalsA,
        tokenSymbolA: pair.token0.symbol,
        tokenAddressB: pair.token1.id,
        tokenDecimalsB,
        tokenSymbolB: pair.token1.symbol,
        rateWith18Decimals,
      };
      return pairDataWithRate;
    });

    return pairData;
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
      case UniswapV2Fork.Sushiswap: {
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
          case NetworkName.Railgun:
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
    if (this.meshes[meshID]) {
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