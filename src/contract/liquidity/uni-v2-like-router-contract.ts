import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { UniV2LikeRouter } from '../../abi-typechain/liquidity/UniV2LikeRouter';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { validateAddress } from '../../utils/address';

export class UniV2LikeRouterContract {
  private readonly contract: UniV2LikeRouter;

  constructor(routerAddress: string) {
    if (!routerAddress) {
      throw new Error('Contract address is required for LP router');
    }
    if (!validateAddress(routerAddress)) {
      throw new Error('Invalid address for LP router contract');
    }
    this.contract = new Contract(
      routerAddress,
      abi.liquidity.uniV2LikeRouter,
    ) as UniV2LikeRouter;
  }

  createAddLiquidity(
    tokenA: string,
    tokenB: string,
    amountADesired: BigNumber,
    amountBDesired: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    to: string,
    deadline: number,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.addLiquidity(
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin,
      to,
      deadline,
    );
  }

  createRemoveLiquidity(
    tokenA: string,
    tokenB: string,
    liquidity: BigNumber,
    amountAMin: BigNumber,
    amountBMin: BigNumber,
    to: string,
    deadline: number,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.removeLiquidity(
      tokenA,
      tokenB,
      liquidity,
      amountAMin,
      amountBMin,
      to,
      deadline,
    );
  }
}
