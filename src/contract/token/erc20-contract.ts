import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi/abi';
import { ERC20 } from '../../abi/token/ERC20';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class ERC20Contract {
  private readonly contract: ERC20;

  constructor(tokenAddress: string) {
    if (!tokenAddress) {
      throw new Error('Token address is required for ERC20 Contract');
    }
    this.contract = new Contract(
      tokenAddress,
      abi.token.erc20,
    ) as unknown as ERC20;
  }

  createSpenderApproval(
    spender: string,
    amount: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.approve(spender, amount);
  }
}
