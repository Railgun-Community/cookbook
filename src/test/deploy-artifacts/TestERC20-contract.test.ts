import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { TestERC20 } from './TestERC20.test';

export class TestERC20Contract {
  private readonly contract: TestERC20;

  constructor(tokenAddress: string, provider?: BaseProvider) {
    this.contract = new Contract(
      tokenAddress,
      abi.token.erc20,
      provider,
    ) as TestERC20;
  }

  mint(toAddress: string, amount: BigNumber): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.mint(toAddress, amount);
  }
}
