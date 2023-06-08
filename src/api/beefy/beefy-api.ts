import {
  NetworkName,
  removeUndefineds,
} from '@railgun-community/shared-models';
import { BeefyApiEndpoint, getBeefyAPIData } from './beefy-fetch';
import { compareTokenAddress } from '../../utils';
import { CookbookDebug } from '../../utils/cookbook-debug';
import { numToBasisPoints } from '../../utils/basis-points';

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

type BeefyAPYAPIData = Record<string, number>;

export type BeefyVaultData = {
  vaultID: string;
  vaultName: string;
  apy: number;
  chain: BeefyChain;
  network: BeefyNetwork;
  depositERC20Address: string;
  depositERC20Decimals: bigint;
  vaultTokenAddress: string;
  vaultContractAddress: string;
  vaultRate: bigint;
  depositFeeBasisPoints: bigint;
  withdrawFeeBasisPoints: bigint;
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
    // 3 min cache
    return (
      !this.cacheTimestamp || this.cacheTimestamp < Date.now() - 3 * 60 * 1000
    );
  }

  private static async getBeefyVaultDataAllChains(
    skipCache: boolean,
  ): Promise<BeefyVaultData[]> {
    if (!skipCache && this.cachedVaultData && !this.cacheExpired()) {
      return this.cachedVaultData;
    }

    const beefyVaultAPIData = await getBeefyAPIData<BeefyVaultAPIData[]>(
      BeefyApiEndpoint.GetVaults,
    );
    const beefyFeesAPIData = await getBeefyAPIData<BeefyFeesAPIData>(
      BeefyApiEndpoint.GetFees,
    );
    const beefyAPYAPIData = await this.getBeefyVaultAPYs();

    const vaultData: BeefyVaultData[] = removeUndefineds(
      beefyVaultAPIData.map(vaultAPIData => {
        const feesData = beefyFeesAPIData[vaultAPIData.id];
        const apy = beefyAPYAPIData[vaultAPIData.id];
        if (feesData == null || apy == null) {
          return undefined;
        }
        if (vaultAPIData.status !== 'active') {
          return undefined;
        }
        if (
          !vaultAPIData.tokenAddress ||
          !vaultAPIData.earnedTokenAddress ||
          !vaultAPIData.earnContractAddress
        ) {
          return undefined;
        }
        const vaultInfo: BeefyVaultData = {
          vaultID: vaultAPIData.id,
          vaultName: vaultAPIData.name,
          apy,
          chain: vaultAPIData.chain,
          network: vaultAPIData.network,
          depositERC20Address: vaultAPIData.tokenAddress.toLowerCase(),
          depositERC20Decimals: BigInt(vaultAPIData.tokenDecimals),
          vaultTokenAddress: vaultAPIData.earnedTokenAddress.toLowerCase(),
          vaultContractAddress: vaultAPIData.earnContractAddress.toLowerCase(),
          vaultRate: BigInt(vaultAPIData.pricePerFullShare),
          depositFeeBasisPoints: numToBasisPoints(feesData?.deposit),
          withdrawFeeBasisPoints: numToBasisPoints(feesData?.withdraw),
        };
        return vaultInfo;
      }),
    );

    this.cachedVaultData = vaultData;
    this.cacheTimestamp = Date.now();

    return vaultData;
  }

  private static async getBeefyVaultAPYs(): Promise<BeefyAPYAPIData> {
    const beefyAPYAPIData = await getBeefyAPIData<BeefyAPYAPIData>(
      BeefyApiEndpoint.GetAPYs,
    );
    return beefyAPYAPIData;
  }

  static async getFilteredBeefyVaults(
    networkName: NetworkName,
    skipCache: boolean,
    depositERC20Address?: string,
    vaultTokenAddress?: string,
  ): Promise<BeefyVaultData[]> {
    try {
      const beefyVaultData = await this.getBeefyVaultDataAllChains(skipCache);

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
      throw new Error(`Could not get active list of Vaults: ${err.message}`);
    }
  }

  static async getBeefyVaultForID(
    vaultID: string,
    networkName: NetworkName,
  ): Promise<BeefyVaultData> {
    const beefyVaults = await this.getFilteredBeefyVaults(
      networkName,
      true, // skipCache
    );

    const beefyVault = beefyVaults.find(vault => vault.vaultID === vaultID);
    if (!beefyVault) {
      throw new Error(
        `Beefy vault with fees/apy data missing for ID: ${vaultID}.`,
      );
    }

    return beefyVault;
  }
}
