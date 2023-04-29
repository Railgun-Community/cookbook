import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi/abi';
import { ERC721 } from '../../abi/token/ERC721';
import { PopulatedTransaction } from '@ethersproject/contracts';

export class RelayAdaptContract {
  private readonly contract: ERC721;

  constructor(tokenAddress: string) {
    if (!tokenAddress) {
      throw new Error('NFT address is required for ERC721 Contract');
    }
    this.contract = new Contract(
      tokenAddress,
      abi.token.erc721,
    ) as unknown as ERC721;
  }

  approveSpender(spender: string): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.setApprovalForAll(spender, true);
  }
}
