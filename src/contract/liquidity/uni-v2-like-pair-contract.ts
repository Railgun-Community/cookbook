import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { UniV2LikePair } from '../../abi-typechain/liquidity/UniV2LikePair';
import { validateAddress } from '../../utils/address';
import { BaseProvider } from '@ethersproject/providers';
import { BigNumber } from 'ethers';

export class UniV2LikePairContract {
  private readonly contract: UniV2LikePair;

  constructor(pairAddress: string, provider?: BaseProvider) {
    if (!pairAddress) {
      throw new Error('Pair address is required for LP router');
    }
    if (!validateAddress(pairAddress)) {
      throw new Error('Invalid pair address for LP router contract');
    }
    this.contract = new Contract(
      pairAddress,
      abi.liquidity.uniV2LikePair,
      provider,
    ) as UniV2LikePair;
  }

  async getReserves() {
    const { _reserve0, _reserve1 } = await this.contract.getReserves();
    return {
      reserveA: _reserve0,
      reserveB: _reserve1,
    };
  }

  async totalSupply(): Promise<BigNumber> {
    const totalSupply = await this.contract.totalSupply();
    return totalSupply;
  }
}
