import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { GMX } from '../gmx';
import { NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../test/test-config.test';
import { RecipeERC20Info } from '../../../models';
import { JsonRpcProvider } from 'ethers';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Arbitrum;

let provider: JsonRpcProvider;

describe('gmx', () => {
  before(() => {
    provider = new JsonRpcProvider('https://rpc.ankr.com/arbitrum');
  });

  it('Should get GLP mint price rate against DAI', async () => {
    const daiERC20Info: RecipeERC20Info = {
      tokenAddress: testConfig.contractsArbitrum.dai,
      decimals: 18n,
    };
    const oneWith18Decimals = 10n ** 18n;

    const glpAmount: bigint = await GMX.getExpectedGLPMintAmountForToken(
      networkName,
      daiERC20Info,
      oneWith18Decimals,
      provider,
    );

    // $0.80 - $1.20
    expect(glpAmount > BigInt('800000000000000000')).to.equal(true);
    expect(glpAmount < BigInt('1200000000000000000')).to.equal(true);
  }).timeout(20000);
});
