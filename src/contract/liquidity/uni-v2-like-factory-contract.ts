import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { validateAddress } from '../../utils/address';
import { BaseProvider } from '@ethersproject/providers';
import { UniV2LikeFactory } from '../../abi-typechain/liquidity/UniV2LikeFactory';

export class UniV2LikeFactoryContract {
  private readonly contract: UniV2LikeFactory;

  constructor(address: string, provider: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid factory address for LP factory contract');
    }
    this.contract = new Contract(
      address,
      abi.liquidity.uniV2LikeFactory,
      provider,
    ) as UniV2LikeFactory;
  }

  async feeTo(): Promise<string> {
    return this.contract.feeTo();
  }
}
