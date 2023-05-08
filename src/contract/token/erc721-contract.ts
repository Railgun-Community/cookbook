import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { ERC721 } from '../../abi-typechain/token/ERC721';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { validateAddress } from '../../utils/address';

export class ERC721Contract {
  private readonly contract: ERC721;

  constructor(nftAddress: string) {
    if (!nftAddress) {
      throw new Error('NFT address is required for ERC721 Contract');
    }
    if (!validateAddress(nftAddress)) {
      throw new Error('Invalid ERC20 address for contract');
    }
    this.contract = new Contract(nftAddress, abi.token.erc721) as ERC721;
  }

  createSpenderApproval(spender: string): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.setApprovalForAll(spender, true);
  }
}
