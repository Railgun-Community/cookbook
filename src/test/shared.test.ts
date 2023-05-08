import { JsonRpcProvider, Web3Provider } from '@ethersproject/providers';
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
import { testConfig } from './test-config.test';
import { RecipeOutput } from '../models';
import { AbstractWallet } from '@railgun-community/engine';

export let testRPCProvider: Optional<JsonRpcProvider>;
export let testRailgunWallet: AbstractWallet;

export const setSharedTestRPCProvider = (provider: JsonRpcProvider) => {
  testRPCProvider = provider;
};

export const setSharedTestRailgunWallet = (wallet: AbstractWallet) => {
  testRailgunWallet = wallet;
};

export const getGanacheProvider = (): JsonRpcProvider => {
  const provider = testRPCProvider;
  if (!provider) {
    throw new Error('No test ethers provider');
  }
  return provider;
};

export const getTestEthersWallet = (): Wallet => {
  const provider = getGanacheProvider();
  return Wallet.fromMnemonic(testConfig.signerMnemonic).connect(provider);
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
  return (await getGanacheProvider().send('evm_snapshot', [])) as number;
};

export const restoreGanacheSnapshot = async (snapshot: number) => {
  await getGanacheProvider().send('evm_revert', [snapshot]);
};

const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2: TransactionGasDetailsSerialized =
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
  const provider = getGanacheProvider();
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
      testConfig.encryptionKey,
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
    testConfig.encryptionKey,
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
        ...MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2,
        gasEstimateString,
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
