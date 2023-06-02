import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { validateAddress } from '../../utils/address';
import { Erc20 } from '../../typechain';

export class ERC20Contract {
  private readonly contract: Erc20;

  constructor(address: string, provider?: Provider) {
    if (!validateAddress(address)) {
      throw new Error('Invalid ERC20 address for contract');
    }
    this.contract = new Contract(
      address,
      abi.token.erc20,
      provider,
    ) as unknown as Erc20;
  }

  createSpenderApproval(
    spender: string,
    amount: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.approve.populateTransaction(spender, amount);
  }

  createTransfer(
    toAddress: string,
    amount: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.transfer.populateTransaction(toAddress, amount);
  }

  balanceOf(account: string): Promise<bigint> {
    return this.contract.balanceOf(account);
  }
}
