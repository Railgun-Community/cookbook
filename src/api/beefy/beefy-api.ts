import { NetworkName } from '@railgun-community/shared-models';
import { BeefyApiEndpoint, getBeefyAPIData } from './beefy-fetch';
import { compareTokenAddress } from '../../utils';
import { CookbookDebug } from '../../utils/cookbook-debug';
import { removeUndefineds } from '@railgun-community/quickstart';

export type BeefyNetwork =
  | 'ethereum'
  | 'polygon'
  | 'bsc'
  | 'arbitrum'
  | 'goerli';
export type BeefyChain = 'ethereum' | 'polygon' | 'bsc' | 'arbitrum' | 'goerli';

type BeefyVaultAPIData = {
  id: string;
  name: string;
  token: string;
  tokenAddress: string;
  tokenDecimals: number;
  tokenProviderId: string;
  tokenAmmId: string;
  earnedToken: string;
  earnedTokenAddress: string;
  earnContractAddress: string;
  oracle: string;
  oracleId: string;
  status: string;
  retireReason: string;
  platformId: string;
  assets: string[];
  risks: string[];
  strategyTypeId: string;
  buyTokenUrl: string;
  addLiquidityUrl: string;
  removeLiquidityUrl: string;
  network: BeefyNetwork;
  createdAt: number;
  chain: BeefyChain;
  strategy: string;
  lastHarvest: number;
  pricePerFullShare: string;
};

type BeefyFeesAPIData = Record<
  string,
  {
    performance: {
      total: number;
      call: number;
      strategist: number;
      treasury: number;
      stakers: number;
    };
    withdraw?: number;
    deposit?: number;
    lastUpdated: number;
  }
>;

export type BeefyVaultData = {
  vaultID: string;
  vaultName: string;
  chain: BeefyChain;
  network: BeefyNetwork;
  depositERC20Address: string;
  depositERC20Decimals: number;
  vaultTokenAddress: string;
  vaultContractAddress: string;
  vaultRate: string;
  depositFee: number;
  withdrawFee: number;
};

export class BeefyAPI {
  static cachedVaultData: Optional<BeefyVaultData[]>;
  static cacheTimestamp: Optional<number>;

  private static getBeefyChainInfoForNetwork(networkName: NetworkName): {
    network: BeefyNetwork;
    chain: BeefyChain;
  } {
    switch (networkName) {
      case NetworkName.Ethereum:
        return { network: 'ethereum', chain: 'ethereum' };
      case NetworkName.BNBChain:
        return { network: 'bsc', chain: 'bsc' };
      case NetworkName.Polygon:
        return { network: 'polygon', chain: 'polygon' };
      case NetworkName.Arbitrum:
        return { network: 'arbitrum', chain: 'arbitrum' };
      case NetworkName.Railgun:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
        throw new Error('Chain not supported by Beefy Vaults');
    }
  }

  static supportsNetwork(networkName: NetworkName): boolean {
    try {
      this.getBeefyChainInfoForNetwork(networkName);
      return true;
    } catch {
      return false;
    }
  }

  private static cacheExpired(): boolean {
    // 15 min
    return (
      !this.cacheTimestamp || this.cacheTimestamp < Date.now() - 15 * 60 * 1000
    );
  }

  private static async getBeefyVaultDataAllChains(): Promise<BeefyVaultData[]> {
    if (this.cachedVaultData && !this.cacheExpired()) {
      return this.cachedVaultData;
    }

    const beefyVaultAPIData = await getBeefyAPIData<BeefyVaultAPIData[]>(
      BeefyApiEndpoint.GetVaults,
    );
    const beefyFeesAPIData = await getBeefyAPIData<BeefyFeesAPIData>(
      BeefyApiEndpoint.GetFees,
    );

    const vaultData: BeefyVaultData[] = removeUndefineds(
      beefyVaultAPIData.map(vaultAPIData => {
        const feesData = beefyFeesAPIData[vaultAPIData.id];
        if (!feesData) {
          return undefined;
        }
        if (vaultAPIData.status !== 'active') {
          return undefined;
        }
        return {
          vaultID: vaultAPIData.id,
          vaultName: vaultAPIData.name,
          chain: vaultAPIData.chain,
          network: vaultAPIData.network,
          depositERC20Address: vaultAPIData.tokenAddress,
          depositERC20Decimals: vaultAPIData.tokenDecimals,
          vaultTokenAddress: vaultAPIData.earnedTokenAddress,
          vaultContractAddress: vaultAPIData.earnContractAddress,
          vaultRate: vaultAPIData.pricePerFullShare,
          depositFee: feesData?.deposit ?? 0,
          withdrawFee: feesData?.withdraw ?? 0,
        };
      }),
    );

    this.cachedVaultData = vaultData;
    this.cacheTimestamp = Date.now();

    return vaultData;
  }

  static async getFilteredBeefyVaults(
    networkName: NetworkName,
    depositERC20Address?: string,
    vaultTokenAddress?: string,
  ): Promise<BeefyVaultData[]> {
    try {
      const beefyVaultData = await this.getBeefyVaultDataAllChains();

      const beefyChainInfo = this.getBeefyChainInfoForNetwork(networkName);
      let filtered = beefyVaultData.filter(
        vault =>
          vault.chain === beefyChainInfo.chain &&
          vault.network === beefyChainInfo.network,
      );

      if (depositERC20Address) {
        filtered = filtered.filter(vault =>
          compareTokenAddress(vault.depositERC20Address, depositERC20Address),
        );
      }
      if (vaultTokenAddress) {
        filtered = filtered.filter(vault =>
          compareTokenAddress(vault.vaultTokenAddress, vaultTokenAddress),
        );
      }

      return filtered;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      CookbookDebug.error(err);
      throw new Error(err.message);
    }
  }
}
