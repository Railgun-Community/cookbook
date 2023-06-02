import { validateAddress } from '../../../utils/address';
import { abi } from '../../../abi/abi';
import { RewardRouterV2 } from '../../../typechain';
import { Contract, ContractTransaction, Provider } from 'ethers';

export class GmxRewardRouterV2Contract {
  private readonly contract: RewardRouterV2;

  constructor(address: string, provider?: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for GMX RewardRouterV2 contract');
    }
    this.contract = new Contract(
      address,
      abi.vault.gmx.rewardRouterV2,
      provider,
    ) as unknown as RewardRouterV2;
  }

  createMintAndStakeGlp(
    token: string,
    amount: bigint,
    minUsdg: bigint,
    minGlp: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.mintAndStakeGlp.populateTransaction(
      token,
      amount,
      minUsdg,
      minGlp,
    );
  }

  createUnstakeAndRedeemGlp(
    tokenOut: string,
    glpAmount: bigint,
    minOut: bigint,
    receiver: string,
  ): Promise<ContractTransaction> {
    return this.contract.unstakeAndRedeemGlp.populateTransaction(
      tokenOut,
      glpAmount,
      minOut,
      receiver,
    );
  }
}
