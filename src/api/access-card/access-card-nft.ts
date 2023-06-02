import { NetworkName } from '@railgun-community/shared-models';
import { AccessCardAccountCreatorContract } from '../../contract/access-card/access-card-account-creator-contract';
import { Provider } from 'ethers';

type AccessCardAccounts = {
  erc721: string;
  accountCreator: string;
};

export class AccessCardNFT {
  static getAddressesForNetwork(networkName: NetworkName): AccessCardAccounts {
    switch (networkName) {
      case NetworkName.Arbitrum:
        return {
          erc721: '0xda8506735140f6c452a1359d31437c1c115e35c3',
          accountCreator: '0xc6E48CC5F16d93873C31Fc74D7f228Cbf24e4B98',
        };
      case NetworkName.Ethereum:
      case NetworkName.BNBChain:
      case NetworkName.Railgun:
      case NetworkName.Polygon:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
        throw new Error('Access card NFT not supported on this network');
    }
  }

  static getOwnableContractAddress(
    networkName: NetworkName,
    nftAddress: string,
    nftTokenSubID: bigint,
    provider: Provider,
  ): Promise<string> {
    const { accountCreator } = this.getAddressesForNetwork(networkName);
    const creator = new AccessCardAccountCreatorContract(
      accountCreator,
      provider,
    );
    return creator.getAddress(nftAddress, nftTokenSubID);
  }
}
