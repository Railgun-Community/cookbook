import ganache from 'ganache';
import { ganacheConfig } from './ganache-config.test';
import { Web3Provider } from '@ethersproject/providers';
import { ERC20Contract } from '../contract/token/erc20-contract';
import debug from 'debug';
import { getTestEthersWallet, setSharedGanacheProvider } from './shared.test';
import { ethers } from 'ethers';

const dbgGanacheEthereum = debug('ganache:ethereum');

export const setupGanacheEthereumRPCAndWallets = async (
  tokenAddresses: string[],
) => {
  dbgGanacheEthereum('Starting Ganache Ethereum RPC...');

  // Get fork block (10000 blocks behind)
  // const jsonRpcProvider = new JsonRpcProvider(ganacheConfig.ethereumForkRPC);
  // const blockNumber = await jsonRpcProvider.getBlockNumber();
  // const ganacheForkBlock = blockNumber - 10000;

  const ganacheServer = ganache.server({
    server: {},
    fork: {
      url: ganacheConfig.ethereumForkRPC,
      // requestsPerSecond: 100,
      // blockNumber: ganacheForkBlock,
    },
    wallet: {
      mnemonic: ganacheConfig.signerMnemonic,
    },
    chain: {
      chainId: 1,
    },
    defaultTransactionGasLimit: 30_000_000,
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
  const ganacheEthersProvider = new Web3Provider(ganacheProvider as any);
  setSharedGanacheProvider(ganacheEthersProvider);

  const wallet = getTestEthersWallet();
  const oneThousand18Decimals = '1000000000000000000000';

  await Promise.all(
    tokenAddresses.map(async tokenAddress => {
      await setTokenBalance(
        ganacheEthersProvider,
        wallet.address,
        tokenAddress,
        oneThousand18Decimals, // 1000 WETH
      );
    }),
  );
};

const setTokenBalance = async (
  provider: Web3Provider,
  walletAddress: string,
  tokenAddress: string,
  balance: string,
) => {
  // Format balance
  const balanceFormatted = `0x${BigInt(balance)
    .toString(16)
    .padStart(64, '0')}`;

  // Get token interface
  const erc20 = new ERC20Contract(tokenAddress, provider);

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

  /**
   * Attempt to change ERC20 balance with storage slot
   */
  const attemptERC20BalanceChange = async (storageSlot: string) => {
    // Get storage before
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const before: string = await provider.send('eth_getStorageAt', [
      tokenAddress,
      storageSlot,
    ]);

    // Set storage
    await provider.send(setRPCCommand, [
      tokenAddress,
      storageSlot,
      balanceFormatted,
    ]);

    // Check if token balance changed
    if ((await erc20.balanceOf(walletAddress)).toBigInt() === BigInt(balance))
      return true;

    // Restore storage before going to next slot
    await provider.send(setRPCCommand, [tokenAddress, storageSlot, before]);

    return false;
  };

  // Loop through storage slots and try to change balance
  let success = false;

  // Loop through storage slots
  for (let i = 0; i < 1000; i += 1) {
    // Try to change for solidity storage layout
    if (
      await attemptERC20BalanceChange(
        ethers.utils.solidityKeccak256(
          ['uint256', 'uint256'],
          [walletAddress, i],
        ),
      )
    ) {
      success = true;
      break;
    }

    // Try to change for vyper storage layout
    if (
      await attemptERC20BalanceChange(
        ethers.utils.solidityKeccak256(
          ['uint256', 'uint256'],
          [i, walletAddress],
        ),
      )
    ) {
      success = true;
      break;
    }
  }

  if (!success) {
    throw new Error(`Could not set token balance for ${tokenAddress}`);
  }
};
