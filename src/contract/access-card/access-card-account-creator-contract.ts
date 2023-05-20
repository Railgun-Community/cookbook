import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { AccessCardAccountCreator } from '../../abi-typechain/access-card/AccessCardAccountCreator';
import { BaseProvider } from '@ethersproject/providers';
import { validateAddress } from '../../utils/address';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class AccessCardAccountCreatorContract {
  private readonly contract: AccessCardAccountCreator;

  constructor(address: string, provider: BaseProvider) {
    if (!validateAddress(address)) {
      throw new Error(
        'Invalid factory address for Access Card Account Creator contract',
      );
    }
    this.contract = new Contract(
      address,
      abi.accessCard.accountCreator,
      provider,
    ) as AccessCardAccountCreator;
  }

  getAddress(nftAddress: string, nftTokenSubID: BigNumber): Promise<string> {
    return this.contract.getAddress(nftAddress, nftTokenSubID);
  }

  createDeploy(
    nftAddress: string,
    nftTokenSubID: BigNumber,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.deploy(nftAddress, nftTokenSubID);
  }
}
