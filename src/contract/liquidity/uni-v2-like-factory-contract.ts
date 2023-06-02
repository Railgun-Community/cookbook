import { Contract, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { UniV2LikeFactory } from '../../typechain';
import { validateAddress } from '../../utils/address';

export class UniV2LikeFactoryContract {
  private readonly contract: UniV2LikeFactory;

  constructor(address: string, provider: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid factory address for LP factory contract');
    }
    this.contract = new Contract(
      address,
      abi.liquidity.uniV2LikeFactory,
      provider,
    ) as unknown as UniV2LikeFactory;
  }

  async feeTo(): Promise<string> {
    return this.contract.feeTo();
  }
}
