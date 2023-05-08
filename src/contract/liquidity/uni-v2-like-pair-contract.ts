import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { UniV2LikePair } from '../../abi-typechain/liquidity/UniV2LikePair';
import { validateAddress } from '../../utils/address';
import { BaseProvider } from '@ethersproject/providers';

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
      amountTokenA: _reserve0,
      amountTokenB: _reserve1,
    };
  }
}
