import ganache from 'ganache';
import { ganacheConfig } from './ganache-config.test';
import { Web3Provider } from '@ethersproject/providers';
import { solidityKeccak256 } from 'ethers/lib/utils';
import { ERC20Contract } from '../contract/token/erc20-contract';
import debug from 'debug';
import { getTestEthersWallet } from './shared.test';

const dbgGanacheEthereum = debug('ganache:ethereum');

export let ganacheEthersProvider: Optional<Web3Provider>;

export const setupGanacheEthereumRPCAndWallets = async () => {
  dbgGanacheEthereum('Starting Ganache Ethereum RPC...');

  const ganacheServer = ganache.server({
    server: {},
    fork: {
      url: ganacheConfig.ethereumForkRPC,
    },
    wallet: {
      mnemonic: ganacheConfig.mnemonic,
    },
    logging: {
      logger: {
        log: msg => {
          if (!ganacheConfig.showVerboseLogs) {
            return;
          }
          dbgGanacheEthereum(msg);
        },
      },
    },
  });

  await ganacheServer.listen(ganacheConfig.ganachePort);

  const ganacheProvider = ganacheServer.provider;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  ganacheEthersProvider = new Web3Provider(ganacheProvider as any);

  const wallet = getTestEthersWallet();
  const oneThousand18Decimals = '1000000000000000000000';

  await setTokenBalance(
    ganacheEthersProvider,
    wallet.address,
    ganacheConfig.contractsEthereum.weth9,
    oneThousand18Decimals, // 1000 WETH
  );
  await setTokenBalance(
    ganacheEthersProvider,
    wallet.address,
    ganacheConfig.contractsEthereum.dai,
    oneThousand18Decimals, // 1000 DAI
  );
  await setTokenBalance(
    ganacheEthersProvider,
    wallet.address,
    ganacheConfig.contractsEthereum.rail,
    oneThousand18Decimals, // 1000 RAIL
  );
};

const setTokenBalance = async (
  provider: Web3Provider,
  address: string,
  token: string,
  balance: string,
) => {
  // Format balance
  const balanceFormatted = `0x${BigInt(balance)
    .toString(16)
    .padStart(64, '0')}`;

  // Get token interface
  const erc20 = new ERC20Contract(token, provider);

  // Get RPC command to set storage
  let setRPCCommand = 'evm_setAccountStorageAt'; // Default
  try {
    // Detect if hardhat
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const response = await provider.send('hardhat_metadata', []);

    // Throw if we're not hardhat
    if (!response) throw new Error();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (!response.clientVersion) throw new Error();

    // Didn't throw, we're hardhat, override the RPC command to hardhat version
    setRPCCommand = 'hardhat_setStorageAt';
  } catch (err) {
    // eslint-disable-next-line no-console
  }

  // Loop through storage slots and try to change balance
  for (let i = 0; i < 1000; i += 1) {
    // Calculate storage slot
    const storageSlot = solidityKeccak256(['uint256', 'uint256'], [address, i]);

    // Get storage before
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const before = await provider.send('eth_getStorageAt', [
      token,
      storageSlot,
    ]);

    // Set storage
    await provider.send(setRPCCommand, [token, storageSlot, balanceFormatted]);

    // Check if token balance changed
    if ((await erc20.balanceOf(address)).toBigInt() === BigInt(balance)) break;

    // Restore storage before going to next slot
    await provider.send(setRPCCommand, [token, storageSlot, before]);
  }
};
