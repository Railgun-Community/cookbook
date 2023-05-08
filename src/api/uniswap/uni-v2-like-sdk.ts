import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { Pair } from 'custom-uniswap-v2-sdk';
import { Token } from '@uniswap/sdk-core';
import { RecipeERC20Info } from '../../models';
import { UniV2LikePairContract } from '../../contract/liquidity/uni-v2-like-pair-contract';
import { BaseProvider } from '@ethersproject/providers';
import { BigNumber } from '@ethersproject/bignumber';

export enum UniswapV2Fork {
  Uniswap = 'Uniswap',
  Sushiswap = 'Sushiswap',
}

export class UniV2LikeSDK {
  private static getFactoryAddressAndInitCodeHash(
    networkName: NetworkName,
    uniswapV2Fork: UniswapV2Fork,
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
      this.getFactoryAddressAndInitCodeHash(networkName, uniswapV2Fork);

    const chainID = NETWORK_CONFIG[networkName].chain.id;
    const tokenA = this.tokenForERC20Info(chainID, erc20InfoA);
    const tokenB = this.tokenForERC20Info(chainID, erc20InfoB);

    return Pair.getAddress(tokenA, tokenB, factoryAddress, initCodeHash);
  }

  static async getPairRate(
    provider: BaseProvider,
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
  ): Promise<BigNumber> {
    const { factoryAddress, initCodeHash } =
      this.getFactoryAddressAndInitCodeHash(networkName, uniswapV2Fork);

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

    const { amountTokenA, amountTokenB } = await pairContract.getReserves();

    const decimals18 = BigNumber.from(10).pow(18);
    const decimalsA = BigNumber.from(10).pow(erc20InfoA.decimals);
    const decimalsB = BigNumber.from(10).pow(erc20InfoB.decimals);

    const rateWith18Decimals = amountTokenA
      .mul(decimals18)
      .mul(decimalsB)
      .div(amountTokenB)
      .div(decimalsA);

    return rateWith18Decimals;
  }
}
