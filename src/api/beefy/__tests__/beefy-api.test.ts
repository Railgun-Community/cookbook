import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { BeefyAPI } from '../beefy-api';
import { NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../test/test-config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('beefy-api', () => {
  const beefyVaultId = 'bifi-vault'; // https://app.beefy.finance/vault/bifi-vault

  before(() => {});

  // @@ TODO: Update vaults with accurate info, its fetching a different one ?. 
  it.skip('Should get Beefy vaults data for each network', async () => {
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
          false, // includeInactiveVaults
        );
        expect(chainVaults.length).to.be.greaterThan(10);
      }),
    );

    const vaultsForEthereumToken = await BeefyAPI.getFilteredBeefyVaults(
      NetworkName.Ethereum,
      false, // skipCache
      false, // includeInactiveVaults
      testConfig.contractsEthereum.conicEthLPToken.toUpperCase(),
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
      depositERC20Symbol: 'cncETH',
      depositERC20Address: '0x58649ec8add732ea710731b5cb37c99529a394d3',
      depositERC20Decimals: 18n,
      depositFeeBasisPoints: 0n,
      network: 'ethereum',
      vaultContractAddress: '0xaf5bf2d152e6a16095588d3438b55edc2bb28343',
      vaultID: 'conic-eth',
      vaultName: 'ETH LP',
      vaultERC20Symbol: 'mooConicETH',
      vaultERC20Address: '0xaf5bf2d152e6a16095588d3438b55edc2bb28343',
      withdrawFeeBasisPoints: 0n,
      isActive: true,
    });
    expect(vaultsForEthereumToken[0].apy).to.be.greaterThan(0.01);
    expect(vaultsForEthereumToken[0].apy).to.be.lessThan(0.5);

    const vaultsForPolygonToken = await BeefyAPI.getFilteredBeefyVaults(
      NetworkName.Polygon,
      false, // skipCache
      false, // includeInactiveVaults
      '0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1'.toUpperCase(),
    );
    expect(vaultsForPolygonToken.length).to.equal(0);
  }).timeout(17500);

  it('Should get specific Beefy vault data', async () => {
    const vaultID = beefyVaultId;
    const vault = await BeefyAPI.getBeefyVaultForID(
      vaultID,
      NetworkName.Ethereum,
    );
    expect(vault.vaultID).to.equal(vaultID);
  }).timeout(7500);

  it('Should get specific Beefy vault APY', async () => {
    const vaultID = beefyVaultId;
    const apy = await BeefyAPI.getBeefyVaultAPY(vaultID);
    expect(apy).to.be.greaterThan(0.001);
  }).timeout(7500);

  it('Should error for inactive Beefy Vault', async () => {
    const vaultID = 'convex-crveth';
    await expect(
      BeefyAPI.getBeefyVaultForID(vaultID, NetworkName.Ethereum),
    ).to.be.rejectedWith(`Beefy vault is not active for ID: ${vaultID}.`);
  }).timeout(7500);
});
