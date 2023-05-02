import { Web3Provider } from '@ethersproject/providers';
import { ganacheEthersProvider } from './ganache-setup.test';

const getProvider = (): Web3Provider => {
  const provider = ganacheEthersProvider;
  if (!provider) {
    throw new Error('No ganache ethers provider');
  }
  return provider;
};

export const takeGanacheSnapshot = async (): Promise<number> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return (await getProvider().send('evm_snapshot', [])) as number;
};

export const restoreGanacheSnapshot = async (snapshot: number) => {
  await getProvider().send('evm_revert', [snapshot]);
};
