import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { AccessCardOwnerAccount } from '../../abi-typechain/access-card/AccessCardOwnerAccount';
import { validateAddress } from '../../utils/address';
import { PopulatedTransaction } from 'ethers';

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
    ) as AccessCardOwnerAccount;
  }

  createCall(
    to: string,
    data: string,
    value: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.call(to, data, value);
  }
}
