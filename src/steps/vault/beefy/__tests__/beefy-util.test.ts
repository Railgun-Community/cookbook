import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BeefyVaultData } from '../../../../api/beefy/beefy-api';
import {
  calculateOutputsForBeefyDeposit,
  calculateOutputsForBeefyWithdraw,
} from '../beefy-util';

chai.use(chaiAsPromised);
const { expect } = chai;

const vault: BeefyVaultData = {
  apy: 0.02050812831779769,
  chain: 'ethereum',
  depositERC20Address: '0x06325440d014e39736583c165c2963ba99faf14e',
  depositERC20Decimals: 18n,
  depositERC20Symbol: 'steCRV',
  depositFeeBasisPoints: 0n,
  isActive: true,
  network: 'ethereum',
  vaultContractAddress: '0xa7739fd3d12ac7f16d8329af3ee407e19de10d8d',
  vaultERC20Address: '0xa7739fd3d12ac7f16d8329af3ee407e19de10d8d',
  vaultERC20Symbol: 'mooConvexStETH',
  vaultID: 'convex-steth',
  vaultName: 'stETH/ETH',
  vaultRate: 1011005831134112183n,
  withdrawFeeBasisPoints: 1n,
};

describe('beefy-util', () => {
  it('Should calculate outputs for beefy deposit', async () => {
    expect(
      calculateOutputsForBeefyDeposit(997500000000000000n, vault),
    ).to.deep.equal({
      depositAmountAfterFee: 997500000000000000n,
      depositFeeAmount: 0n,

      // TODO: This +1n should not occur. It's because the vaultRate is rounded. We could fix with the totalSupply and pool amounts.
      // https://github.com/beefyfinance/beefy-contracts/blob/6ec0105986aaf6cf4a0b64127829001d51f3955a/contracts/BIFI/vaults/BeefyVaultV7.sol#L112
      receivedVaultTokenAmount: 986641193632917231n + 1n,
    });
  });

  it('Should calculate outputs for beefy withdraw', async () => {
    expect(
      calculateOutputsForBeefyWithdraw(997500000000000000n, vault),
    ).to.deep.equal({
      receivedWithdrawAmount: 1008478316556276902n,
      withdrawFeeAmount: 100847831655627n,

      // TODO: This -1n should not occur. It's because the vaultRate is rounded. We could fix with the totalSupply and pool amounts.
      // https://github.com/beefyfinance/beefy-contracts/blob/6ec0105986aaf6cf4a0b64127829001d51f3955a/contracts/BIFI/vaults/BeefyVaultV7.sol#L112
      withdrawAmountAfterFee: 1008377468724621276n - 1n,
    });
  });
});
