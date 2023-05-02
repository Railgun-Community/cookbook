import { Web3Provider } from '@ethersproject/providers';
import { ganacheEthersProvider } from './ganache-setup.test';
import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
} from '@railgun-community/quickstart';
import {
  EVMGasType,
  NetworkName,
  TransactionGasDetailsSerialized,
  deserializeTransaction,
  serializeUnsignedTransaction,
} from '@railgun-community/shared-models';
import { Wallet } from 'ethers';
import { testRailgunWallet } from './railgun-setup.test';
import { ganacheConfig } from './ganache-config.test';
import { RecipeOutput } from '../models';

const getProvider = (): Web3Provider => {
  const provider = ganacheEthersProvider;
  if (!provider) {
    throw new Error('No ganache ethers provider');
  }
  return provider;
};

export const getTestEthersWallet = () => {
  const provider = getProvider();
  return Wallet.fromMnemonic(ganacheConfig.mnemonic).connect(provider);
};

export const getTestRailgunWallet = () => {
  const wallet = testRailgunWallet;
  if (!wallet) {
    throw new Error('No test railgun wallet created');
  }
  return wallet;
};

export const takeGanacheSnapshot = async (): Promise<number> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return (await getProvider().send('evm_snapshot', [])) as number;
};

export const restoreGanacheSnapshot = async (snapshot: number) => {
  await getProvider().send('evm_revert', [snapshot]);
};

export const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2: TransactionGasDetailsSerialized =
  {
    evmGasType: EVMGasType.Type2,
    gasEstimateString: '0x00',
    maxFeePerGasString: '0x1234567890',
    maxPriorityFeePerGasString: '0x123456',
  };

export const createQuickstartCrossContractCallsForTest = async (
  networkName: NetworkName,
  recipeOutput: RecipeOutput,
) => {
  const provider = getProvider();
  const railgunWallet = getTestRailgunWallet();

  const {
    populatedTransactions,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Addresses,
    shieldNFTs,
  } = recipeOutput;

  const sendWithPublicWallet = true;

  const crossContractCallsSerialized: string[] = populatedTransactions.map(
    serializeUnsignedTransaction,
  );

  const { gasEstimateString, error: gasEstimateError } =
    await gasEstimateForUnprovenCrossContractCalls(
      networkName,
      railgunWallet.id,
      ganacheConfig.encryptionKey,
      unshieldERC20Amounts,
      unshieldNFTs,
      shieldERC20Addresses,
      shieldNFTs,
      crossContractCallsSerialized,
      MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2,
      undefined, // feeTokenDetails
      sendWithPublicWallet,
    );
  if (gasEstimateError) {
    throw new Error(`Error getting gas estimate: ${gasEstimateError}`);
  }
  if (!gasEstimateString) {
    throw new Error(`No gas estimate created`);
  }

  const { error: generateProofError } = await generateCrossContractCallsProof(
    networkName,
    railgunWallet.id,
    ganacheConfig.encryptionKey,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Addresses,
    shieldNFTs,
    crossContractCallsSerialized,
    undefined, // relayerFeeERC20AmountRecipient
    sendWithPublicWallet,
    undefined, // overallBatchMinGasPrice
    () => {}, // progressCallback
  );
  if (generateProofError) {
    throw new Error(`Error generating proof: ${generateProofError}`);
  }

  const { serializedTransaction, error: populateCallsError } =
    await populateProvedCrossContractCalls(
      networkName,
      railgunWallet.id,
      unshieldERC20Amounts,
      unshieldNFTs,
      shieldERC20Addresses,
      shieldNFTs,
      crossContractCallsSerialized,
      undefined, // relayerFeeERC20AmountRecipient
      sendWithPublicWallet,
      undefined, // overallBatchMinGasPrice
      {
        gasPriceString: '0x1000',
        gasEstimateString,
        evmGasType: EVMGasType.Type0,
      },
    );
  if (populateCallsError) {
    throw new Error(`Error populating calls: ${populateCallsError}`);
  }
  if (!serializedTransaction) {
    throw new Error(`No populated transaction created`);
  }

  const chainId = (await provider.getNetwork()).chainId;

  const transaction = deserializeTransaction(
    serializedTransaction,
    undefined,
    chainId,
  );

  return { gasEstimateString, transaction };
};
