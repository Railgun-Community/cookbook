import { Contract } from '@ethersproject/contracts';
import { abi } from '../../abi-typechain/abi';
import { BigNumber } from '@ethersproject/bignumber';
import { PopulatedTransaction } from '@ethersproject/contracts';
import { BaseProvider } from '@ethersproject/providers';
import { TestERC721 } from './TestERC721.test';

export class TestERC721Contract {
  private readonly contract: TestERC721;

  constructor(tokenAddress: string, provider?: BaseProvider) {
    this.contract = new Contract(
      tokenAddress,
      abi.token.erc20,
      provider,
    ) as TestERC721;
  }

  mint(toAddress: string, tokenId: BigNumber): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.mint(toAddress, tokenId);
  }
}
