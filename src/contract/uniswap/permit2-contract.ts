import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { Permit2 } from '../../typechain';
import { validateContractAddress } from '../../utils/address';
export class UniswapPermit2Contract {
  private readonly contract: Permit2;

  constructor(address: string, provider?: Provider) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid address for Permit2 contract');
    }
    this.contract = new Contract(
      address,
      abi.swap.uniswap,
      provider,
    ) as unknown as Permit2;
  }

  createApproval(
    approvalTo: string,
    approvalToken: string,
    approvalTimeout: bigint,
    approvalAmount: bigint,
  ): Promise<ContractTransaction> {
    console.log('approvalTo', approvalTo)
    console.log('approvalToken', approvalToken)
    console.log('approvalTimeout', approvalTimeout)
    console.log('approvalAmount', approvalAmount)

    return this.contract.approve.populateTransaction(
      approvalToken,
      approvalTo,
      approvalAmount,
      approvalTimeout,
    );
  }

}
