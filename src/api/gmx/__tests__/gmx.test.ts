import { JsonRpcProvider } from '@ethersproject/providers';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { GMX } from '../gmx';
import { NetworkName } from '@railgun-community/shared-models';
import { testConfig } from '../../../test/test-config.test';
import { RecipeERC20Info } from '../../../models';
import { BigNumber } from '@ethersproject/bignumber';

chai.use(chaiAsPromised);
const { expect } = chai;

const networkName = NetworkName.Arbitrum;

let provider: JsonRpcProvider;

describe('gmx', () => {
  before(() => {
    provider = new JsonRpcProvider('https://arbitrum-rpc.gateway.pokt.network');
  });

  it('Should get GLP mint price rate against DAI', async () => {
    const daiERC20Info: RecipeERC20Info = {
      tokenAddress: testConfig.contractsArbitrum.dai,
      decimals: 18,
    };
    const oneWith18Decimals = BigNumber.from(10).pow(18);

    const glpAmount: BigNumber = await GMX.getExpectedGLPMintAmountForToken(
      networkName,
      daiERC20Info,
      oneWith18Decimals,
      provider,
    );

    // $0.80 - $1.20
    expect(glpAmount.gt(BigNumber.from('800000000000000000'))).to.equal(true);
    expect(glpAmount.lt(BigNumber.from('1200000000000000000'))).to.equal(true);
  }).timeout(20000);
});
