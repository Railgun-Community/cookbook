import { Provider } from '@ethersproject/abstract-provider';
import { Signer } from '@ethersproject/abstract-signer';
import { Contract } from '@ethersproject/contracts';
import { abi } from '../abi/abi';
import { ERC20 } from './types/ERC20';

export const erc20Contract = (
  tokenAddress: string,
  signerOrProvider: Signer | Provider,
) => {
  if (!tokenAddress || !tokenAddress.length) {
    throw new Error('Token address is required for ERC20 Contract');
  }

  return new Contract(
    tokenAddress,
    abi.erc20,
    signerOrProvider,
  ) as unknown as ERC20;
};
