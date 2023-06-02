import { Contract, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { UniV2LikePair } from '../../typechain';
import { validateAddress } from '../../utils/address';

export class UniV2LikePairContract {
  private readonly contract: UniV2LikePair;

  constructor(address: string, provider: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid pair address for LP router contract');
    }
    this.contract = new Contract(
      address,
      abi.liquidity.uniV2LikePair,
      provider,
    ) as unknown as UniV2LikePair;
  }

  async getReserves() {
    const { _reserve0, _reserve1 } = await this.contract.getReserves();
    return {
      reserveA: _reserve0,
      reserveB: _reserve1,
    };
  }

  async totalSupply(): Promise<bigint> {
    const totalSupply = await this.contract.totalSupply();
    return totalSupply;
  }

  async kLast(): Promise<bigint> {
    return this.contract.kLast();
  }
}
