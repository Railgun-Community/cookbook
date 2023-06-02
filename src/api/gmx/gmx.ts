import { NetworkName } from '@railgun-community/shared-models';
import { RecipeERC20Info } from '../../models';
import { GmxGlpManagerContract } from '../../contract/vault/gmx/gmx-glp-manager-contract';
import { GmxVaultContract } from '../../contract/vault/gmx/gmx-vault-contract';
import { Provider } from 'ethers';

type GMXInfo = {
  glpAddress: string;
  glpManagerAddress: string;
  vaultAddress: string;
  rewardRouterContractAddress: string;
  stakeableERC20Addresses: string[];
};

export const GLP_DECIMALS = 18n;

export const PRICE_PRECISION_DECIMALS = 30n;

export class GMX {
  static getGMXInfoForNetwork(networkName: NetworkName): GMXInfo {
    switch (networkName) {
      case NetworkName.Arbitrum:
        return {
          glpAddress: '0x4277f8f2c384827b5273592ff7cebd9f2c1ac258',
          glpManagerAddress: '0x3963FfC9dff443c2A94f21b129D429891E32ec18',
          vaultAddress: '0x489ee077994B6658eAfA855C308275EAd8097C4A',
          rewardRouterContractAddress:
            '0xB95DB5B167D75e6d04227CfFFA61069348d271F5',
          stakeableERC20Addresses: [
            '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
          ],
        };
      case NetworkName.Ethereum:
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.EthereumRopsten_DEPRECATED:
      case NetworkName.EthereumGoerli:
      case NetworkName.PolygonMumbai:
      case NetworkName.ArbitrumGoerli:
      case NetworkName.Hardhat:
      case NetworkName.Railgun:
        throw new Error('Network not supported by GMX');
    }
  }

  static supportsNetwork(networkName: NetworkName): boolean {
    try {
      this.getGMXInfoForNetwork(networkName);
      return true;
    } catch {
      return false;
    }
  }

  static async getExpectedGLPMintAmountForToken(
    networkName: NetworkName,
    erc20Info: RecipeERC20Info,
    amount: bigint,
    provider: Provider,
  ): Promise<bigint> {
    const { glpManagerAddress, vaultAddress } =
      this.getGMXInfoForNetwork(networkName);

    const glpManager = new GmxGlpManagerContract(glpManagerAddress, provider);
    const vault = new GmxVaultContract(vaultAddress, provider);

    const isMintingGLP = true;
    const [glpPrice, tokenPrice] = await Promise.all([
      glpManager.getGLPPriceInUSD(isMintingGLP),
      vault.getTokenPriceInUSD(erc20Info.tokenAddress, isMintingGLP),
    ]);

    const glpDecimalMultiplier = 10n ** GLP_DECIMALS;
    const tokenDecimalMultiplier = 10n ** erc20Info.decimals;

    return (
      (amount * glpDecimalMultiplier * glpPrice) /
      tokenPrice /
      tokenDecimalMultiplier
    );
  }
}
