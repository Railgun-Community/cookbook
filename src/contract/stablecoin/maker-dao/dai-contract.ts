import { Contract } from '@ethersproject/contracts';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { abi } from '../../../abi-typechain/abi';
import { NetworkName } from '@railgun-community/shared-models';

export class DaiContract {
  private readonly contract: Contract;

  constructor(networkName: NetworkName, provider?: BaseProvider) {
    const tokenAddress = DaiContract.getTokenAddress(networkName);

    // TODO: Add typechain support for DAI with ethers v6
    // https://github.com/dethcrypto/TypeChain/blob/master/examples/ethers-v6/types/ethers-contracts/Dai.ts
    this.contract = new Contract(tokenAddress, abi.stablecoin.dai, provider);
  }

  private static getTokenAddress(networkName: NetworkName): string {
    switch (networkName) {
      case NetworkName.Ethereum:
        return '0x6B175474E89094C44Da98b954EedeAC495271d0F';
      case NetworkName.EthereumGoerli:
        return '0xdc31ee1784292379fbb2964b3b9c4124d8f89c60';
      case NetworkName.Railgun:
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.Arbitrum:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
        throw new Error('Dai is not mintable on this network.');
    }
  }

  static supportsNetwork(networkName: NetworkName) {
    try {
      DaiContract.getTokenAddress(networkName);
      return true;
    } catch {
      return false;
    }
  }

  createMint(
    toAddress: string,
    amount: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.mint(toAddress, amount);
  }

  balanceOf(account: string): Promise<BigNumber> {
    return this.contract.balanceOf(account);
  }
}
