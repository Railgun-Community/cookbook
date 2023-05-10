import { JsonRpcProvider, TransactionRequest } from '@ethersproject/providers';
import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
} from '@railgun-community/quickstart';
import {
  EVMGasType,
  NetworkName,
  RailgunERC20Amount,
  RailgunERC20AmountRecipient,
  TransactionGasDetailsSerialized,
  deserializeTransaction,
  serializeUnsignedTransaction,
} from '@railgun-community/shared-models';
import { Wallet } from 'ethers';
import { testConfig } from './test-config.test';
import { RecipeInput, RecipeOutput } from '../models';
import {
  AbstractWallet,
  MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
} from '@railgun-community/engine';

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

const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_1: TransactionGasDetailsSerialized =
  {
    evmGasType: EVMGasType.Type1,
    gasEstimateString: '0x00',
    gasPriceString: '0x1234567890',
  };
const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2: TransactionGasDetailsSerialized =
  {
    evmGasType: EVMGasType.Type2,
    gasEstimateString: '0x00',
    maxFeePerGasString: '0x1234567890',
    maxPriorityFeePerGasString: '0x123456',
  };

const MOCK_RAILGUN_ADDRESS =
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts';

export const createQuickstartCrossContractCallsForTest = async (
  networkName: NetworkName,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): Promise<{
  gasEstimateString: Optional<string>;
  transaction: TransactionRequest;
}> => {
  const provider = getGanacheProvider();
  const railgunWallet = getTestRailgunWallet();

  const { erc20Amounts, nfts: unshieldNFTs } = recipeInput;
  const unshieldERC20Amounts: RailgunERC20Amount[] = erc20Amounts.map(
    erc20Amount => ({
      tokenAddress: erc20Amount.tokenAddress,
      amountString: erc20Amount.amount.toHexString(),
    }),
  );

  const { populatedTransactions, shieldERC20Amounts, shieldNFTs } =
    recipeOutput;

  const shieldERC20Addresses = shieldERC20Amounts.map(
    shieldERC20Amount => shieldERC20Amount.tokenAddress,
  );

  if (unshieldERC20Amounts.length < 1) {
    throw new Error(
      'Test cross-contract call runner requires at least 1 unshield ERC20 amount.',
    );
  }

  // Proof/transaction requires relayer fee in order to parse the relay adapt error for testing.
  // Ie. RelayAdapt transaction must continue after revert, and emit event with error details.
  const mockRelayerFeeRecipient: RailgunERC20AmountRecipient = {
    tokenAddress: unshieldERC20Amounts[0].tokenAddress,
    amountString: '0x00',
    recipientAddress: MOCK_RAILGUN_ADDRESS,
  };

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
      true, // sendWithPublicWallet
    );
  if (gasEstimateError) {
    // eslint-disable-next-line no-console
    console.error(
      'Received gas estimate error, which does not contain details of failure. Continuing transaction in order to parse RelayAdapt revert error.',
    );
    // eslint-disable-next-line no-console
    console.log(gasEstimateError);
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
    mockRelayerFeeRecipient,
    false, // sendWithPublicWallet
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
      mockRelayerFeeRecipient,
      false, // sendWithPublicWallet
      undefined, // overallBatchMinGasPrice
      {
        ...MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_1,
        gasEstimateString:
          gasEstimateString ??
          MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT.toHexString(),
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
