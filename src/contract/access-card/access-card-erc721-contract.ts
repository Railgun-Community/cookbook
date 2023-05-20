import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { AccessCardERC721 } from '../../abi-typechain/access-card/AccessCardERC721';

export class AccessCardERC721Contract {
  private readonly contract: AccessCardERC721;

  constructor(tokenAddress: string) {
    this.contract = new Contract(
      tokenAddress,
      abi.token.accessCardERC721,
    ) as AccessCardERC721;
  }

  mint(toAddress: string, tokenId: BigNumber): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.mint(toAddress, tokenId);
  }
}
