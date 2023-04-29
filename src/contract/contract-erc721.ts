import { Provider } from '@ethersproject/abstract-provider';
import { Signer } from '@ethersproject/abstract-signer';
import { Contract } from '@ethersproject/contracts';
import { abi } from '../abi/abi';
import { ERC721 } from './types/ERC721';

export const erc721Contract = (
  nftAddress: string,
  signerOrProvider: Signer | Provider,
) => {
  if (!nftAddress || !nftAddress.length) {
    throw new Error('NFT address is required for ERC721 Contract');
  }

  return new Contract(
    nftAddress,
    abi.erc721,
    signerOrProvider,
  ) as unknown as ERC721;
};
