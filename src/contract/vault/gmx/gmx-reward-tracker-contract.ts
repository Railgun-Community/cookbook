import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi-typechain/abi';
import { Contract, PopulatedTransaction } from '@ethersproject/contracts';
import { RewardTracker } from '../../../abi-typechain/vault/gmx/RewardTracker';
import { BigNumber } from '@ethersproject/bignumber';

export class GmxRewardTrackerContract {
  private readonly contract: RewardTracker;

  constructor(vaultAddress: string, provider?: BaseProvider) {
    if (!vaultAddress) {
      throw new Error('Vault address is required for GMX Vault Contract');
    }
    if (!validateAddress(vaultAddress)) {
      throw new Error('Invalid Vault address for GMX Vault contract');
    }
    this.contract = new Contract(
      vaultAddress,
      abi.vault.gmx,
      provider,
    ) as RewardTracker;
  }

  createStake(
    depositToken: string,
    amount: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.stake(depositToken, amount);
  }

  createUnstake(
    depositToken: string,
    amount: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.unstake(depositToken, amount);
  }

  createClaim(receiver: string): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.claim(receiver);
  }
}
