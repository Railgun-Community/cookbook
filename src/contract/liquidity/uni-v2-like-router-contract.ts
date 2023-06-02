import { Contract, ContractTransaction } from 'ethers';
import { abi } from '../../abi/abi';
import { UniV2LikeRouter } from '../../typechain';
import { validateAddress } from '../../utils/address';

export class UniV2LikeRouterContract {
  private readonly contract: UniV2LikeRouter;

  constructor(address: string) {
    if (!validateAddress(address)) {
      throw new Error('Invalid address for LP router contract');
    }
    this.contract = new Contract(
      address,
      abi.liquidity.uniV2LikeRouter,
    ) as unknown as UniV2LikeRouter;
  }

  createAddLiquidity(
    tokenA: string,
    tokenB: string,
    amountADesired: bigint,
    amountBDesired: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    to: string,
    deadline: number,
  ): Promise<ContractTransaction> {
    return this.contract.addLiquidity.populateTransaction(
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
    liquidity: bigint,
    amountAMin: bigint,
    amountBMin: bigint,
    to: string,
    deadline: number,
  ): Promise<ContractTransaction> {
    return this.contract.removeLiquidity.populateTransaction(
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
