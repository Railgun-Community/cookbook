import { Contract, ContractTransaction } from 'ethers';
import { abi } from '../../abi/abi';
import { Erc721 } from '../../typechain';
import { validateContractAddress } from '../../utils/address';

export class ERC721Contract {
  private readonly contract: Erc721;

  constructor(address: string) {
    if (!validateContractAddress(address)) {
      throw new Error('Invalid ERC20 address for contract');
    }
    this.contract = new Contract(
      address,
      abi.token.erc721,
    ) as unknown as Erc721;
  }

  createSpenderApprovalForAll(spender: string): Promise<ContractTransaction> {
    return this.contract.setApprovalForAll.populateTransaction(spender, true);
  }
}
