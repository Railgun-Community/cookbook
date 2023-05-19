import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { ERC721 } from '../../abi-typechain/token/ERC721';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { validateAddress } from '../../utils/address';

export class ERC721Contract {
  private readonly contract: ERC721;

  constructor(address: string) {
    if (!validateAddress(address)) {
      throw new Error('Invalid ERC20 address for contract');
    }
    this.contract = new Contract(address, abi.token.erc721) as ERC721;
  }

  createSpenderApproval(spender: string): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.setApprovalForAll(spender, true);
  }
}
