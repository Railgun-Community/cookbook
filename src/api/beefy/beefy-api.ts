import {
  NetworkName,
  isDefined,
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

type BeefyFeesAPIData = {
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
};

type BeefyFeesAPIDataMap = Record<string, BeefyFeesAPIData>;

type BeefyAPYAPIData = Record<string, number>;

type BeefyTVLAPIData = Record<string, Record<string, number>>;

export const BEEFY_VAULT_ERC20_DECIMALS = 18n;

export type BeefyVaultData = {
  vaultID: string;
  vaultName: string;
  apy: number;
  // tvlUSD: number;
  chain: BeefyChain;
  network: BeefyNetwork;
  depositERC20Symbol: string;
  depositERC20Address: string;
  depositERC20Decimals: bigint;
  vaultERC20Symbol: string;
  vaultERC20Address: string;
  vaultContractAddress: string;
  vaultRate: bigint;
  depositFeeBasisPoints: bigint;
  withdrawFeeBasisPoints: bigint;
  isActive: boolean;
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
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli_DEPRECATED:
      case NetworkName.PolygonMumbai_DEPRECATED:
      case NetworkName.ArbitrumGoerli_DEPRECATED:
      case NetworkName.EthereumSepolia:
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
      !isDefined(this.cacheTimestamp) ||
      this.cacheTimestamp < Date.now() - 3 * 60 * 1000
    );
  }

  private static async getBeefyVaultDataAllChains(
    skipCache: boolean,
    includeInactiveVaults = false,
  ): Promise<BeefyVaultData[]> {
    if (!skipCache && this.cachedVaultData && !this.cacheExpired()) {
      return this.cachedVaultData;
    }

    const [
      beefyVaultAPIData,
      beefyFeesAPIData,
      beefyAPYAPIData,
      // beefyTVLAPIData,
    ] = await Promise.all([
      getBeefyAPIData<BeefyVaultAPIData[]>(BeefyApiEndpoint.GetVaults),
      getBeefyAPIData<BeefyFeesAPIDataMap>(BeefyApiEndpoint.GetFees),
      this.getBeefyVaultAPYs(),
      // this.getBeefyVaultTVLs(),
    ]);

    const vaultData: BeefyVaultData[] = removeUndefineds(
      beefyVaultAPIData.map(vaultAPIData => {
        const feesData = beefyFeesAPIData[vaultAPIData.id];
        const apy = beefyAPYAPIData[vaultAPIData.id];
        // const tvlUSD = beefyTVLAPIData[String(chainID)][vaultAPIData.id]; // Requires chain ID.
        if (feesData == null || apy == null) {
          return undefined;
        }
        const isActive = vaultAPIData.status === 'active';
        if (!includeInactiveVaults && !isActive) {
          return undefined;
        }
        if (
          !vaultAPIData.tokenAddress ||
          !vaultAPIData.earnedTokenAddress ||
          !vaultAPIData.earnContractAddress
        ) {
          return undefined;
        }
        return this.convertAPIDataToBeefyVaultData(
          vaultAPIData,
          feesData,
          apy,
          isActive,
        );
      }),
    );

    this.cachedVaultData = vaultData;
    this.cacheTimestamp = Date.now();

    return vaultData;
  }

  static async getBeefyVaultAPY(vaultID: string): Promise<number> {
    const apys = await this.getBeefyVaultAPYs();
    return apys[vaultID];
  }

  private static convertAPIDataToBeefyVaultData(
    vaultAPIData: BeefyVaultAPIData,
    feesData: BeefyFeesAPIData,
    apy: number,
    isActive: boolean,
  ): Optional<BeefyVaultData> {
    try {
      const vaultInfo: BeefyVaultData = {
        vaultID: vaultAPIData.id,
        vaultName: vaultAPIData.name,
        apy,
        // tvlUSD,
        chain: vaultAPIData.chain,
        network: vaultAPIData.network,
        depositERC20Symbol: vaultAPIData.token,
        depositERC20Address: vaultAPIData.tokenAddress.toLowerCase(),
        depositERC20Decimals: BigInt(vaultAPIData.tokenDecimals),
        vaultERC20Symbol: vaultAPIData.earnedToken,
        vaultERC20Address: vaultAPIData.earnedTokenAddress.toLowerCase(),
        vaultContractAddress: vaultAPIData.earnContractAddress.toLowerCase(),
        vaultRate: this.parseVaultRate(vaultAPIData.pricePerFullShare),
        depositFeeBasisPoints: numToBasisPoints(feesData?.deposit),
        withdrawFeeBasisPoints: numToBasisPoints(feesData?.withdraw),
        isActive,
      };
      return vaultInfo;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      // CookbookDebug.error(
      //   new Error(
      //     `Could not parse Beefy Vault data for ${vaultAPIData.id}: ${err.message}`,
      //   ),
      // );
      return undefined;
    }
  }

  private static parseVaultRate(pricePerFullShare: string): bigint {
    // NOTE: Some inactive vaults currently have pricePerFullShare in scientific notation.
    // This will crash, which returns undefined in the above try/catch.
    return BigInt(pricePerFullShare);
  }

  private static async getBeefyVaultAPYs(): Promise<BeefyAPYAPIData> {
    const beefyAPYAPIData = await getBeefyAPIData<BeefyAPYAPIData>(
      BeefyApiEndpoint.GetAPYs,
    );
    return beefyAPYAPIData;
  }

  private static async getBeefyVaultTVLs(): Promise<BeefyTVLAPIData> {
    const beefyTVLAPIData = await getBeefyAPIData<BeefyTVLAPIData>(
      BeefyApiEndpoint.GetTVLs,
    );
    return beefyTVLAPIData;
  }

  static async getFilteredBeefyVaults(
    networkName: NetworkName,
    skipCache: boolean,
    includeInactiveVaults: boolean,
    depositERC20Address?: string,
    vaultERC20Address?: string,
  ): Promise<BeefyVaultData[]> {
    try {
      const beefyVaultData = await this.getBeefyVaultDataAllChains(
        skipCache,
        includeInactiveVaults,
      );

      const beefyChainInfo = this.getBeefyChainInfoForNetwork(networkName);
      let filtered = beefyVaultData.filter(
        vault =>
          vault.chain === beefyChainInfo.chain &&
          vault.network === beefyChainInfo.network,
      );

      if (isDefined(depositERC20Address)) {
        filtered = filtered.filter(vault =>
          compareTokenAddress(vault.depositERC20Address, depositERC20Address),
        );
      }
      if (isDefined(vaultERC20Address)) {
        filtered = filtered.filter(vault =>
          compareTokenAddress(vault.vaultERC20Address, vaultERC20Address),
        );
      }

      return filtered;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Unexpected non-error thrown', { cause });
      }
      CookbookDebug.error(cause);
      throw new Error('Could not get active list of Vaults.', { cause });
    }
  }

  static async getBeefyVaultForID(
    vaultID: string,
    networkName: NetworkName,
  ): Promise<BeefyVaultData> {
    const beefyVaults = await this.getFilteredBeefyVaults(
      networkName,
      true, // skipCache
      true, // includeInactiveVaults
    );

    const beefyVault = beefyVaults.find(vault => vault.vaultID === vaultID);
    if (!beefyVault) {
      throw new Error(
        `Beefy vault with fees/apy data missing for ID: ${vaultID}.`,
      );
    }
    if (!beefyVault.isActive) {
      throw new Error(`Beefy vault is not active for ID: ${vaultID}.`);
    }

    return beefyVault;
  }
}
