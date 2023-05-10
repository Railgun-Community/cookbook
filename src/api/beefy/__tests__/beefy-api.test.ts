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

    const vaultsForPolygonToken = await BeefyAPI.getFilteredBeefyVaults(
      NetworkName.Polygon,
      false, // skipCache
      '0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1'.toUpperCase(),
    );
    expect(vaultsForPolygonToken.length).to.equal(0);
  }).timeout(20000);
});
