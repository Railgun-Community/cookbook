import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  mnemonicToPKey,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import {
  EVMGasType,
  NetworkName,
  RailgunERC20Amount,
  RailgunERC20AmountRecipient,
  TransactionGasDetails,
  isDefined,
} from '@railgun-community/shared-models';
import { ContractTransaction, JsonRpcProvider, Wallet } from 'ethers';
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
  const pkey = mnemonicToPKey(testConfig.signerMnemonic);
  return new Wallet(pkey).connect(provider);
};

export const getTestRailgunWallet = () => {
  const wallet = testRailgunWallet;
  if (!isDefined(wallet)) {
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

const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_1: TransactionGasDetails = {
  evmGasType: EVMGasType.Type1,
  gasEstimate: 0n,
  gasPrice: BigInt('0x1234567890'),
};
const MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2: TransactionGasDetails = {
  evmGasType: EVMGasType.Type2,
  gasEstimate: 0n,
  maxFeePerGas: BigInt('0x1234567890'),
  maxPriorityFeePerGas: BigInt('0x123456'),
};

const MOCK_RAILGUN_ADDRESS =
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts';

export const createQuickstartCrossContractCallsForTest = async (
  networkName: NetworkName,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): Promise<{
  gasEstimate: Optional<bigint>;
  transaction: ContractTransaction;
}> => {
  const railgunWallet = getTestRailgunWallet();

  const { erc20Amounts, nfts: unshieldNFTs } = recipeInput;
  const unshieldERC20Amounts: RailgunERC20Amount[] = erc20Amounts;

  const {
    crossContractCalls,
    erc20Amounts: shieldERC20Amounts,
    nfts: shieldNFTs,
  } = recipeOutput;

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
    amount: 0n,
    recipientAddress: MOCK_RAILGUN_ADDRESS,
  };

  let gasEstimate: Optional<bigint>;
  try {
    const { gasEstimate: resolvedGasEstimate } =
      await gasEstimateForUnprovenCrossContractCalls(
        networkName,
        railgunWallet.id,
        testConfig.encryptionKey,
        unshieldERC20Amounts,
        unshieldNFTs,
        shieldERC20Addresses,
        shieldNFTs,
        crossContractCalls,
        MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2,
        undefined, // feeTokenDetails
        true, // sendWithPublicWallet
      );
    gasEstimate = resolvedGasEstimate;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      'Received gas estimate error, which does not contain details of revert. Continuing transaction in order to parse RelayAdapt revert error.',
    );
    // eslint-disable-next-line no-console
    console.error(err);
  }

  await generateCrossContractCallsProof(
    networkName,
    railgunWallet.id,
    testConfig.encryptionKey,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Addresses,
    shieldNFTs,
    crossContractCalls,
    mockRelayerFeeRecipient,
    false, // sendWithPublicWallet
    undefined, // overallBatchMinGasPrice
    () => {}, // progressCallback
  );

  const { transaction } = await populateProvedCrossContractCalls(
    networkName,
    railgunWallet.id,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Addresses,
    shieldNFTs,
    crossContractCalls,
    mockRelayerFeeRecipient,
    false, // sendWithPublicWallet
    undefined, // overallBatchMinGasPrice
    {
      ...MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_1,
      gasEstimate:
        gasEstimate ?? MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
    },
  );

  return { gasEstimate, transaction };
};
