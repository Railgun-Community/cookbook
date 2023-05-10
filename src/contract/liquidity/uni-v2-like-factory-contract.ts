import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { validateAddress } from '../../utils/address';
import { BaseProvider } from '@ethersproject/providers';
import { UniV2LikeFactory } from '../../abi-typechain/liquidity/UniV2LikeFactory';

export class UniV2LikeFactoryContract {
  private readonly contract: UniV2LikeFactory;

  constructor(factoryAddress: string, provider: BaseProvider) {
    if (!factoryAddress) {
      throw new Error('Factory address is required for LP factory contract');
    }
    if (!validateAddress(factoryAddress)) {
      throw new Error('Invalid factory address for LP factory contract');
    }
    this.contract = new Contract(
      factoryAddress,
      abi.liquidity.uniV2LikeFactory,
      provider,
    ) as UniV2LikeFactory;
  }

  async feeTo(): Promise<string> {
    return this.contract.feeTo();
  }
}
