import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { Pair } from 'custom-uniswap-v2-sdk';
import { Token } from '@uniswap/sdk-core';
import { RecipeERC20Info, UniswapV2Fork } from '../../models/export-models';
import { UniV2LikePairContract } from '../../contract/liquidity/uni-v2-like-pair-contract';
import { BaseProvider } from '@ethersproject/providers';
import { BigNumber } from '@ethersproject/bignumber';
import { PairDataWithRate } from '../../models/uni-v2-like';
import { calculatePairRateWith18Decimals } from '../../utils/pair-rate';
import { UniV2LikeSubgraph } from '../../graph/uni-v2-like-graph';
import { CookbookDebug } from '../../utils/cookbook-debug';

export class UniV2LikeSDK {
  static LIQUIDITY_TOKEN_DECIMALS = 18;

  private static getFactoryAddressAndInitCodeHash(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): { factoryAddress: string; initCodeHash: string } {
    switch (uniswapV2Fork) {
      case UniswapV2Fork.Uniswap:
        // https://github.com/Uniswap/v2-sdk/blob/main/src/constants.ts

        if (networkName === NetworkName.Ethereum) {
          return {
            factoryAddress: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
            initCodeHash:
              '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
          };
        }
        throw new Error('Uniswap V2 LP is not supported on this network');

      case UniswapV2Fork.Sushiswap: {
        // If adding any networks, make sure to check both factory address and initCodeHash:
        // https://github.com/sushiswap/sushiswap-sdk/tree/canary/src/constants

        let factoryAddress: string;
        switch (networkName) {
          case NetworkName.Ethereum:
            factoryAddress = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
            break;
          case NetworkName.EthereumGoerli:
          case NetworkName.Polygon:
          case NetworkName.PolygonMumbai:
          case NetworkName.BNBChain:
          case NetworkName.Arbitrum:
            factoryAddress = '0xc35DADB65012eC5796536bD9864eD8773aBc74C4';
            break;
          case NetworkName.ArbitrumGoerli:
          case NetworkName.EthereumRopsten_DEPRECATED:
          case NetworkName.Railgun:
          case NetworkName.Hardhat:
            throw new Error('Sushiswap V2 LP is not supported on this network');
        }
        return {
          factoryAddress,
          initCodeHash:
            '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
        };
      }
    }
  }

  private static supportsNetwork(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): boolean {
    try {
      this.getFactoryAddressAndInitCodeHash(uniswapV2Fork, networkName);
      return true;
    } catch {
      return false;
    }
  }

  static supportsForkAndNetwork(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): boolean {
    return (
      this.supportsNetwork(uniswapV2Fork, networkName) &&
      UniV2LikeSubgraph.subgraphSupportsUniV2Fork(uniswapV2Fork, networkName)
    );
  }

  private static tokenForERC20Info(
    chainID: number,
    erc20Info: RecipeERC20Info,
  ) {
    return new Token(chainID, erc20Info.tokenAddress, erc20Info.decimals);
  }

  static getPairLPAddress(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
  ): string {
    const { factoryAddress, initCodeHash } =
      this.getFactoryAddressAndInitCodeHash(uniswapV2Fork, networkName);

    const chainID = NETWORK_CONFIG[networkName].chain.id;
    const tokenA = this.tokenForERC20Info(chainID, erc20InfoA);
    const tokenB = this.tokenForERC20Info(chainID, erc20InfoB);

    return Pair.getAddress(tokenA, tokenB, factoryAddress, initCodeHash);
  }

  static getForkName(uniswapV2Fork: UniswapV2Fork) {
    switch (uniswapV2Fork) {
      case UniswapV2Fork.Uniswap:
        return 'Uniswap V2';
      case UniswapV2Fork.Sushiswap:
        return 'Sushiswap V2';
    }
  }

  static getPairName(
    uniswapV2Fork: UniswapV2Fork,
    erc20SymbolA: RecipeERC20Info,
    erc20SymbolB: RecipeERC20Info,
  ) {
    return `${this.getForkName(
      uniswapV2Fork,
    )}: ${erc20SymbolA}-${erc20SymbolB}`;
  }

  static async getPairRate(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    provider: BaseProvider,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
  ): Promise<BigNumber> {
    const { factoryAddress, initCodeHash } =
      this.getFactoryAddressAndInitCodeHash(uniswapV2Fork, networkName);

    const chainID = NETWORK_CONFIG[networkName].chain.id;
    const tokenA = this.tokenForERC20Info(chainID, erc20InfoA);
    const tokenB = this.tokenForERC20Info(chainID, erc20InfoB);

    const pairAddress = Pair.getAddress(
      tokenA,
      tokenB,
      factoryAddress,
      initCodeHash,
    );

    const pairContract = new UniV2LikePairContract(pairAddress, provider);

    const { reserveA, reserveB } = await pairContract.getReserves();
    const rateWith18Decimals = calculatePairRateWith18Decimals(
      reserveA,
      erc20InfoA.decimals,
      reserveB,
      erc20InfoB.decimals,
    );

    return rateWith18Decimals;
  }

  static getAllLPPairsForTokenAddresses(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    tokenAddresses: string[],
  ): Promise<PairDataWithRate[]> {
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
  }
}
