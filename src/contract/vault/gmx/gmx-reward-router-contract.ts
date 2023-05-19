import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi-typechain/abi';
import { Contract, PopulatedTransaction } from '@ethersproject/contracts';
import { BigNumber } from '@ethersproject/bignumber';
import { RewardRouter } from '../../../abi-typechain/vault/gmx/RewardRouter';

export class GmxRewardRouterContract {
  private readonly contract: RewardRouter;

  constructor(address: string, provider?: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX RewardRouter contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.rewardRouter,
      provider,
    ) as RewardRouter;
  }

  createMintAndStakeGlp(
    token: string,
    amount: BigNumber,
    minUsdg: BigNumber,
    minGlp: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.mintAndStakeGlp(
      token,
      amount,
      minUsdg,
      minGlp,
    );
  }

  createUnstakeAndRedeemGlp(
    tokenOut: string,
    glpAmount: BigNumber,
    minOut: BigNumber,
    receiver: string,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.unstakeAndRedeemGlp(
      tokenOut,
      glpAmount,
      minOut,
      receiver,
    );
  }
}
