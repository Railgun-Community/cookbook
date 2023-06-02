import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { BeefyAPI } from '../beefy-api';
import { NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../test/test-config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('beefy-api', () => {
  before(() => {});

  it('Should get Beefy vaults data for each network', async () => {
    const supportedNetworks = [
      NetworkName.Ethereum,
      NetworkName.Polygon,
      NetworkName.BNBChain,
      NetworkName.Arbitrum,
    ];

    await Promise.all(
      supportedNetworks.map(async networkName => {
        const chainVaults = await BeefyAPI.getFilteredBeefyVaults(
          networkName,
          false, // skipCache
        );
        expect(chainVaults.length).to.be.greaterThan(10);
      }),
    );

    const vaultsForEthereumToken = await BeefyAPI.getFilteredBeefyVaults(
      NetworkName.Ethereum,
      false, // skipCache
      testConfig.contractsEthereum.usdcWethSushiswapV2LPToken.toUpperCase(),
    );
    expect(vaultsForEthereumToken.length).to.equal(1);
    expect({
      ...vaultsForEthereumToken[0],
      apy: 0,
      vaultRate: 1n,
    }).to.deep.equal({
      // Set to exact values to skip comparison:
      apy: 0,
      vaultRate: 1n,

      // Compare the rest of the values:
      chain: 'ethereum',
      depositERC20Address: '0x397ff1542f962076d0bfe58ea045ffa2d347aca0',
      depositERC20Decimals: 18n,
      depositFeeBasisPoints: 0n,
      network: 'ethereum',
      vaultContractAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
      vaultID: 'sushi-mainnet-usdc-weth',
      vaultName: 'ETH-USDC LP',
      vaultTokenAddress: '0x61f96ca5c79c9753c93244c73f1d4b4a90c1ac8c',
      withdrawFeeBasisPoints: 10n,
    });
    expect(vaultsForEthereumToken[0].apy).to.be.greaterThan(0.001);
    expect(vaultsForEthereumToken[0].apy).to.be.lessThan(0.2);

    const vaultsForPolygonToken = await BeefyAPI.getFilteredBeefyVaults(
      NetworkName.Polygon,
      false, // skipCache
      '0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1'.toUpperCase(),
    );
    expect(vaultsForPolygonToken.length).to.equal(0);
  }).timeout(20000);
});
