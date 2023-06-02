import { Contract, ContractTransaction, Provider } from 'ethers';
import { abi } from '../../abi/abi';
import { AccessCardAccountCreator } from '../../typechain';
import { validateAddress } from '../../utils/address';

export class AccessCardAccountCreatorContract {
  private readonly contract: AccessCardAccountCreator;

  constructor(address: string, provider: Provider) {
    if (!validateAddress(address)) {
      throw new Error(
        'Invalid factory address for Access Card Account Creator contract',
      );
    }
    this.contract = new Contract(
      address,
      abi.accessCard.accountCreator,
      provider,
    ) as unknown as AccessCardAccountCreator;
  }

  getAddress(nftAddress: string, nftTokenSubID: bigint): Promise<string> {
    return this.contract.getAddress(nftAddress, nftTokenSubID);
  }

  createDeploy(
    nftAddress: string,
    nftTokenSubID: bigint,
  ): Promise<ContractTransaction> {
    return this.contract.deploy.populateTransaction(nftAddress, nftTokenSubID);
  }
}
