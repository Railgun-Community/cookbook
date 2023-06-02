import { abi } from '../../abi/abi';
import { validateAddress } from '../../utils/address';
import { AccessCardOwnerAccount } from '../../typechain';
import { Contract, ContractTransaction } from 'ethers';

export class AccessCardOwnerAccountContract {
  private readonly contract: AccessCardOwnerAccount;

  constructor(address: string) {
    if (!validateAddress(address)) {
      throw new Error(
        'Invalid factory address for Access Card Account Owner contract',
      );
    }
    this.contract = new Contract(
      address,
      abi.accessCard.ownerAccount,
    ) as unknown as AccessCardOwnerAccount;
  }

  createCall(
    to: string,
    data: string,
    value: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.call.populateTransaction(to, data, value);
  }
}
