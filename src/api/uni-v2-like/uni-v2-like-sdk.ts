import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { Pair } from 'custom-uniswap-v2-sdk';
import { Token } from '@uniswap/sdk-core';
import {
  RecipeAddLiquidityData,
  RecipeERC20Amount,
  RecipeERC20Info,
  RecipeRemoveLiquidityData,
  UniswapV2Fork,
} from '../../models/export-models';
import { UniV2LikePairContract } from '../../contract/liquidity/uni-v2-like-pair-contract';
import {
  calculatePairRateWith18Decimals,
  getPairTokenDecimals,
} from '../../utils/lp-pair';
import { UniV2LikeSubgraph } from '../../graph/uni-v2-like-subgraph';
import { UniV2LikeFactoryContract } from '../../contract/liquidity/uni-v2-like-factory-contract';
import { ZERO_ADDRESS } from '../../models/constants';
import { babylonianSqrt } from '../../utils/big-number';
import { Provider } from 'ethers';

export class UniV2LikeSDK {
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

      case UniswapV2Fork.PancakeSwap:
        if (networkName === NetworkName.BNBChain) {
          return {
            factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
            initCodeHash:
              '0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5',
          };
        }
        throw new Error('PancakeSwap V2 LP is not supported on this network');

      case UniswapV2Fork.Quickswap:
        if (networkName === NetworkName.Polygon) {
          return {
            factoryAddress: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
            initCodeHash:
              '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
          };
        }
        throw new Error('Quickswap V2 LP is not supported on this network');

      case UniswapV2Fork.SushiSwap: {
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
          case NetworkName.EthereumSepolia:
          case NetworkName.Hardhat:
            throw new Error('SushiSwap V2 LP is not supported on this network');
        }

        return {
          factoryAddress,
          initCodeHash:
            '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
        };
      }
    }
  }

  static getRouterContractAddress(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): string {
    switch (uniswapV2Fork) {
      case UniswapV2Fork.Uniswap:
        if (networkName === NetworkName.Ethereum) {
          return '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';
        }
        throw new Error('Uniswap V2 LP is not supported on this network');

      case UniswapV2Fork.PancakeSwap:
        if (networkName === NetworkName.BNBChain) {
          return '0x10ED43C718714eb63d5aA57B78B54704E256024E';
        }
        throw new Error('PancakeSwap V2 LP is not supported on this network');

      case UniswapV2Fork.Quickswap:
        if (networkName === NetworkName.Polygon) {
          return '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff';
        }
        throw new Error('Quickswap V2 LP is not supported on this network');

      case UniswapV2Fork.SushiSwap: {
        // Look for "SushiSwapRouter" for each chain:
        // https://dev.sushi.com/docs/Developers/Deployment%20Addresses
        switch (networkName) {
          case NetworkName.Ethereum:
            return '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';
          case NetworkName.EthereumGoerli:
            return '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
          case NetworkName.Polygon:
            return '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
          case NetworkName.PolygonMumbai:
            return '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
          case NetworkName.BNBChain:
            return '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
          case NetworkName.Arbitrum:
            return '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
          case NetworkName.ArbitrumGoerli:
          case NetworkName.EthereumRopsten_DEPRECATED:
          case NetworkName.EthereumSepolia:
          case NetworkName.Hardhat:
            throw new Error('SushiSwap V2 LP is not supported on this network');
        }
      }
    }
  }

  private static supportsNetwork(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
  ): boolean {
    try {
      this.getFactoryAddressAndInitCodeHash(uniswapV2Fork, networkName);
      this.getRouterContractAddress(uniswapV2Fork, networkName);
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
    return new Token(
      chainID,
      erc20Info.tokenAddress,
      Number(erc20Info.decimals),
    );
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

    return Pair.getAddress(
      tokenA,
      tokenB,
      factoryAddress,
      initCodeHash,
    ).toLowerCase();
  }

  static getForkName(uniswapV2Fork: UniswapV2Fork) {
    switch (uniswapV2Fork) {
      case UniswapV2Fork.Uniswap:
        return 'Uniswap V2';
      case UniswapV2Fork.SushiSwap:
        return 'SushiSwap V2';
      case UniswapV2Fork.PancakeSwap:
        return 'PancakeSwap V2';
      case UniswapV2Fork.Quickswap:
        return 'Quickswap V2';
    }
  }

  static getLPName(uniswapV2Fork: UniswapV2Fork) {
    return `${this.getForkName(uniswapV2Fork)} Pool`;
  }

  static async getPairRateWith18Decimals(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    provider: Provider,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
  ): Promise<bigint> {
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

  private static getDeadlineTimestamp() {
    // 5 minutes from now
    return Date.now() + 5 * 60 * 1000;
  }

  private static async getLPLiquidityDetailsAfterFee(
    factoryAddress: string,
    pairAddress: string,
    provider: Provider,
  ): Promise<{
    reserveA: bigint;
    reserveB: bigint;
    totalSupply: bigint;
    lpFeeAmount: bigint;
  }> {
    const factoryContract = new UniV2LikeFactoryContract(
      factoryAddress,
      provider,
    );
    const pairContract = new UniV2LikePairContract(pairAddress, provider);

    const [{ reserveA, reserveB }, totalSupply, kLast, feeTo] =
      await Promise.all([
        pairContract.getReserves(),
        pairContract.totalSupply(),
        pairContract.kLast(),
        factoryContract.feeTo(),
      ]);

    const lpFeeAmount = this.getLPFeeAmount(
      reserveA,
      reserveB,
      totalSupply,
      kLast,
      feeTo,
    );

    return { reserveA, reserveB, totalSupply, lpFeeAmount };
  }

  static async getAddLiquidityData(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    erc20AmountA: RecipeERC20Amount,
    erc20InfoB: RecipeERC20Info,
    slippageBasisPoints: bigint,
    provider: Provider,
  ): Promise<RecipeAddLiquidityData> {
    const { factoryAddress } = this.getFactoryAddressAndInitCodeHash(
      uniswapV2Fork,
      networkName,
    );
    const pairAddress = this.getPairLPAddress(
      uniswapV2Fork,
      networkName,
      erc20AmountA,
      erc20InfoB,
    );
    const { reserveA, reserveB, totalSupply, lpFeeAmount } =
      await this.getLPLiquidityDetailsAfterFee(
        factoryAddress,
        pairAddress,
        provider,
      );

    const newTotalSupply = totalSupply + lpFeeAmount;

    const expectedLPBalance = (erc20AmountA.amount * newTotalSupply) / reserveA;
    const expectedLPAmount: RecipeERC20Amount = {
      tokenAddress: pairAddress,
      decimals: getPairTokenDecimals(),
      amount: expectedLPBalance,
    };

    const amountB = (expectedLPBalance * reserveB) / newTotalSupply;
    const erc20AmountB: RecipeERC20Amount = {
      ...erc20InfoB,
      amount: amountB,
    };

    const routerContractAddress = this.getRouterContractAddress(
      uniswapV2Fork,
      networkName,
    );
    const deadlineTimestamp = this.getDeadlineTimestamp();

    return {
      erc20AmountA,
      erc20AmountB,
      expectedLPAmount,
      routerContractAddress,
      slippageBasisPoints,
      deadlineTimestamp,
    };
  }

  static async getRemoveLiquidityData(
    uniswapV2Fork: UniswapV2Fork,
    networkName: NetworkName,
    lpERC20Amount: RecipeERC20Amount,
    erc20InfoA: RecipeERC20Info,
    erc20InfoB: RecipeERC20Info,
    slippageBasisPoints: bigint,
    provider: Provider,
  ): Promise<RecipeRemoveLiquidityData> {
    const { factoryAddress } = this.getFactoryAddressAndInitCodeHash(
      uniswapV2Fork,
      networkName,
    );
    const pairAddress = this.getPairLPAddress(
      uniswapV2Fork,
      networkName,
      erc20InfoA,
      erc20InfoB,
    );
    if (pairAddress !== lpERC20Amount.tokenAddress) {
      throw new Error(
        'LP token address does not match pair address. Token A and B must be ordered by bytes.',
      );
    }
    const { reserveA, reserveB, totalSupply, lpFeeAmount } =
      await this.getLPLiquidityDetailsAfterFee(
        factoryAddress,
        pairAddress,
        provider,
      );

    const newLiquidity = lpERC20Amount.amount - lpFeeAmount;
    const expectedAmountA = (newLiquidity * reserveA) / totalSupply;
    const expectedAmountB = (newLiquidity * reserveB) / totalSupply;

    const routerContractAddress = this.getRouterContractAddress(
      uniswapV2Fork,
      networkName,
    );

    const deadlineTimestamp = this.getDeadlineTimestamp();

    const expectedERC20AmountA: RecipeERC20Amount = {
      ...erc20InfoA,
      amount: expectedAmountA,
    };
    const expectedERC20AmountB: RecipeERC20Amount = {
      ...erc20InfoB,
      amount: expectedAmountB,
    };

    return {
      lpERC20Amount,
      expectedERC20AmountA,
      expectedERC20AmountB,
      routerContractAddress,
      slippageBasisPoints,
      deadlineTimestamp,
    };
  }

  private static getLPFeeAmount(
    reserveA: bigint,
    reserveB: bigint,
    totalSupply: bigint,
    kLast: bigint,
    feeTo: string,
  ): bigint {
    if (feeTo === ZERO_ADDRESS || kLast === 0n) {
      return 0n;
    }
    const rootK = babylonianSqrt(reserveA * reserveB);
    const rootKLast = babylonianSqrt(kLast);
    if (rootK <= rootKLast) {
      return 0n;
    }

    const numerator = totalSupply * (rootK - rootKLast);
    const denominator = rootK * 5n + rootKLast * 4n;
    const liquidity = numerator / denominator;
    if (liquidity === 0n) {
      return 0n;
    }

    const feeAmount = (liquidity * 3n) / 1000n;
    return feeAmount;
  }
}
