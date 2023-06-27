import {
  RecipeERC20AmountRecipient,
  StepInput,
  UnvalidatedStepOutput,
} from '../models/export-models';
import { RailgunNFTAmount, isDefined } from '@railgun-community/shared-models';

export const validateStepOutput = (
  input: StepInput,
  output: UnvalidatedStepOutput,
) => {
  try {
    validateStepOutputERC20Amounts(input, output);
    validateStepOutputNFTs(input, output);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    throw new Error(`Validation Error: ${err.message}`);
  }
};

const getTokenId = (tokenAddress: string, isBaseToken?: boolean) => {
  const lcToken = tokenAddress.toLowerCase();
  return isDefined(isBaseToken) && isBaseToken ? `${lcToken}-base` : lcToken;
};

const validateStepOutputERC20Amounts = (
  input: StepInput,
  output: UnvalidatedStepOutput,
) => {
  const inputERC20AmountMap: Record<string, bigint> = {};
  const outputERC20AmountMap: Record<string, bigint> = {};

  // Add all erc20 inputs.
  input.erc20Amounts.forEach(
    ({ tokenAddress, expectedBalance, isBaseToken }) => {
      const id = getTokenId(tokenAddress, isBaseToken);
      inputERC20AmountMap[id] ??= 0n;
      inputERC20AmountMap[id] = inputERC20AmountMap[id] + expectedBalance;
    },
  );

  // Add all erc20 outputs.
  output.outputERC20Amounts.forEach(
    ({ tokenAddress, expectedBalance, minBalance, isBaseToken }) => {
      const id = getTokenId(tokenAddress, isBaseToken);
      outputERC20AmountMap[id] ??= 0n;
      outputERC20AmountMap[id] = outputERC20AmountMap[id] + expectedBalance;
      if (expectedBalance < minBalance) {
        throw new Error('Min balance must be >= expected balance.');
      }
    },
  );

  const eradicatedERC20Amounts: RecipeERC20AmountRecipient[] = [
    ...(output.spentERC20Amounts ?? []),
    ...(output.feeERC20AmountRecipients ?? []),
  ];
  eradicatedERC20Amounts.forEach(({ tokenAddress, amount, isBaseToken }) => {
    const id = getTokenId(tokenAddress, isBaseToken);
    outputERC20AmountMap[id] ??= 0n;
    outputERC20AmountMap[id] = outputERC20AmountMap[id] + amount;
  });

  for (const id in inputERC20AmountMap) {
    if (!outputERC20AmountMap[id]) {
      throw new Error(`Missing output for ${id}.`);
    }
    if (inputERC20AmountMap[id] !== outputERC20AmountMap[id]) {
      throw new Error(
        `Input erc20 amounts for ${id} (${inputERC20AmountMap[id]}) must match total outputs/spent/fees (${outputERC20AmountMap[id]}).`,
      );
    }
  }

  // TODO: Combine outputs for same tokens.
};

const validateStepOutputNFTs = (
  input: StepInput,
  output: UnvalidatedStepOutput,
) => {
  const inputNFTMap: Record<string, Record<string, bigint>> = {};
  const outputNFTMap: Record<string, Record<string, bigint>> = {};

  // Add all NFT inputs.
  input.nfts.forEach(({ nftAddress, tokenSubID, amount }) => {
    inputNFTMap[nftAddress] ??= {};
    if (amount > 1n) {
      throw new Error('NFTs must have amount 1');
    }
    if (inputNFTMap[nftAddress][tokenSubID]) {
      throw new Error(`Duplicate NFT input for ${nftAddress}: ${tokenSubID}`);
    }
    inputNFTMap[nftAddress][tokenSubID] = 1n;
  });

  // Add all NFT outputs.
  const nftOutputs: RailgunNFTAmount[] = [
    ...(output.spentNFTs ?? []),
    ...(output.outputNFTs ?? []),
  ];
  nftOutputs.forEach(({ nftAddress, tokenSubID, amount }) => {
    outputNFTMap[nftAddress] ??= {};
    if (amount > 1n) {
      throw new Error('NFTs must have amount 1');
    }
    if (outputNFTMap[nftAddress][tokenSubID]) {
      throw new Error(`Duplicate NFT input for ${nftAddress}: ${tokenSubID}`);
    }
    outputNFTMap[nftAddress][tokenSubID] = 1n;
  });

  for (const nftAddress in inputNFTMap) {
    for (const tokenSubID in inputNFTMap[nftAddress]) {
      if (!outputNFTMap[nftAddress]?.[tokenSubID]) {
        throw new Error(
          `Input NFT ${nftAddress}:${tokenSubID} must match NFT output.`,
        );
      }
    }
  }
};
