import {
  gasEstimateForUnprovenCrossContractCalls,
  generateCrossContractCallsProof,
  mnemonicTo0xPKey,
  populateProvedCrossContractCalls,
} from '@railgun-community/wallet';
import {
  EVMGasType,
  NetworkName,
  RailgunERC20AmountRecipient,
  RailgunERC20Recipient,
  RailgunNFTAmountRecipient,
  TXIDVersion,
  TransactionGasDetails,
  isDefined,
} from '@railgun-community/shared-models';
import { ContractTransaction, JsonRpcProvider, Wallet } from 'ethers';
import { testConfig } from './test-config.test';
import { RecipeInput, RecipeOutput } from '../models';
import { AbstractWallet } from '@railgun-community/engine';

export let testRPCProvider: Optional<JsonRpcProvider>;
export let testRailgunWallet: AbstractWallet;
export let testRailgunWallet2: AbstractWallet;

export const setSharedTestRPCProvider = (provider: JsonRpcProvider) => {
  testRPCProvider = provider;
};

export const setSharedTestRailgunWallet = (wallet: AbstractWallet) => {
  testRailgunWallet = wallet;
};

export const setSharedTestRailgunWallet2 = (wallet: AbstractWallet) => {
  testRailgunWallet2 = wallet;
};

export const getTestProvider = (): JsonRpcProvider => {
  const provider = testRPCProvider;
  if (!provider) {
    throw new Error('No test ethers provider');
  }
  return provider;
};

export const getTestEthersWallet = (): Wallet => {
  const provider = getTestProvider();
  const pkey = mnemonicTo0xPKey(testConfig.signerMnemonic);
  return new Wallet(pkey).connect(provider);
};

export const getTestRailgunWallet = () => {
  const wallet = testRailgunWallet;
  if (!isDefined(wallet)) {
    throw new Error('No test railgun wallet created');
  }
  return wallet;
};

export const getTestRailgunWallet2 = () => {
  const wallet = testRailgunWallet2;
  if (!isDefined(wallet)) {
    throw new Error('No test railgun wallet 2 created');
  }
  return wallet;
};

export const takeGanacheSnapshot = async (): Promise<number> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return (await getTestProvider().send('evm_snapshot', [])) as number;
};

export const restoreGanacheSnapshot = async (snapshot: number) => {
  await getTestProvider().send('evm_revert', [snapshot]);
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

export const createCrossContractCallsForTest = async (
  txidVersion: TXIDVersion,
  networkName: NetworkName,
  recipeInput: RecipeInput,
  recipeOutput: RecipeOutput,
): Promise<{
  gasEstimate: Optional<bigint>;
  transaction: ContractTransaction;
}> => {
  const railgunWallet = getTestRailgunWallet();

  const { erc20Amounts: unshieldERC20Amounts, nfts: unshieldNFTs } =
    recipeInput;
  const { minGasLimit } = recipeOutput;

  const { crossContractCalls, erc20AmountRecipients, nftRecipients } =
    recipeOutput;

  const shieldERC20Recipients: RailgunERC20Recipient[] =
    erc20AmountRecipients.map(erc20AmountRecipient => ({
      tokenAddress: erc20AmountRecipient.tokenAddress,
      recipientAddress: erc20AmountRecipient.recipient,
    }));

  const shieldNFTRecipients: RailgunNFTAmountRecipient[] = nftRecipients.map(
    nftRecipient => ({
      nftAddress: nftRecipient.nftAddress,
      nftTokenType: nftRecipient.nftTokenType,
      tokenSubID: nftRecipient.tokenSubID,
      amount: nftRecipient.amount,
      recipientAddress: nftRecipient.recipient,
    }),
  );

  // Proof/transaction requires relayer fee in order to parse the relay adapt error for testing.
  // Ie. RelayAdapt transaction must continue after revert, and emit event with error details.
  // NFT-only tests will not have this benefit.
  const useRelayerFee = unshieldERC20Amounts.length < 1;
  const mockRelayerFeeRecipient: Optional<RailgunERC20AmountRecipient> =
    useRelayerFee
      ? {
          tokenAddress: unshieldERC20Amounts[0].tokenAddress,
          amount: 0n,
          recipientAddress: MOCK_RAILGUN_ADDRESS,
        }
      : undefined;
  const sendWithPublicWallet = !useRelayerFee;

  let gasEstimate: Optional<bigint>;
  try {
    const { gasEstimate: resolvedGasEstimate } =
      await gasEstimateForUnprovenCrossContractCalls(
        txidVersion,
        networkName,
        railgunWallet.id,
        testConfig.encryptionKey,
        unshieldERC20Amounts,
        unshieldNFTs,
        shieldERC20Recipients,
        shieldNFTRecipients,
        crossContractCalls,
        MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2,
        undefined, // feeTokenDetails
        sendWithPublicWallet,
        minGasLimit,
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
    txidVersion,
    networkName,
    railgunWallet.id,
    testConfig.encryptionKey,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Recipients,
    shieldNFTRecipients,
    crossContractCalls,
    mockRelayerFeeRecipient,
    sendWithPublicWallet,
    undefined, // overallBatchMinGasPrice
    minGasLimit,
    () => {}, // progressCallback
  );

  const transactionGasDetails: TransactionGasDetails = useRelayerFee
    ? {
        ...MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_1,
        gasEstimate: gasEstimate ?? minGasLimit,
      }
    : {
        ...MOCK_TRANSACTION_GAS_DETAILS_SERIALIZED_TYPE_2,
        gasEstimate: gasEstimate ?? minGasLimit,
      };
  const { transaction } = await populateProvedCrossContractCalls(
    txidVersion,
    networkName,
    railgunWallet.id,
    unshieldERC20Amounts,
    unshieldNFTs,
    shieldERC20Recipients,
    shieldNFTRecipients,
    crossContractCalls,
    mockRelayerFeeRecipient,
    sendWithPublicWallet,
    undefined, // overallBatchMinGasPrice
    transactionGasDetails,
  );

  return { gasEstimate, transaction };
};
