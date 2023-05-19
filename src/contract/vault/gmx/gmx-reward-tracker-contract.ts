import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi-typechain/abi';
import { Contract, PopulatedTransaction } from '@ethersproject/contracts';
import { RewardTracker } from '../../../abi-typechain/vault/gmx/RewardTracker';
import { BigNumber } from '@ethersproject/bignumber';

export class GmxRewardTrackerContract {
  private readonly contract: RewardTracker;

  constructor(address: string, provider: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX RewardTracker contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.rewardTracker,
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
