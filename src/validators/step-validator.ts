import {
  RecipeERC20AmountRecipient,
  StepInput,
  UnvalidatedStepOutput,
} from '../models/export-models';
import { RailgunNFTAmount, isDefined } from '@railgun-community/shared-models';
// Direct module import (not the utils barrel) to keep madge --circular clean.
import { nftIdentityKey } from '../utils/nft';

export const validateStepOutput = (
  input: StepInput,
  output: UnvalidatedStepOutput,
) => {
  try {
    validateStepOutputERC20Amounts(input, output);
    validateStepOutputNFTs(input, output);
  } catch (cause) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    throw new Error(`Validation Error`, { cause });
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
    if (!isDefined(outputERC20AmountMap[id])) {
      throw new Error(`Missing output for ${id}.`);
    }
    if (outputERC20AmountMap[id] === 0n) {
      throw new Error(`Missing output value for ${id}.`);
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
  // Keyed on nftIdentityKey rather than the raw (nftAddress, tokenSubID) pair,
  // so an input carrying a zero-padded tokenSubID still matches an output that
  // derived the unpadded form (or vice versa). Value is the caller-facing label
  // for the error message.
  const inputNFTMap: Record<string, string> = {};
  const outputNFTMap: Record<string, string> = {};

  const label = ({ nftAddress, tokenSubID }: RailgunNFTAmount) =>
    `${nftAddress}:${tokenSubID}`;

  // Add all NFT inputs.
  input.nfts.forEach(nft => {
    if (nft.amount > 1n) {
      throw new Error('NFTs must have amount 1');
    }
    const key = nftIdentityKey(nft);
    if (isDefined(inputNFTMap[key])) {
      throw new Error(
        `Duplicate NFT input for ${nft.nftAddress}: ${nft.tokenSubID}`,
      );
    }
    inputNFTMap[key] = label(nft);
  });

  // Add all NFT outputs.
  const nftOutputs: RailgunNFTAmount[] = [
    ...(output.spentNFTs ?? []),
    ...(output.outputNFTs ?? []),
  ];
  nftOutputs.forEach(nft => {
    if (nft.amount > 1n) {
      throw new Error('NFTs must have amount 1');
    }
    const key = nftIdentityKey(nft);
    if (isDefined(outputNFTMap[key])) {
      throw new Error(
        `Duplicate NFT input for ${nft.nftAddress}: ${nft.tokenSubID}`,
      );
    }
    outputNFTMap[key] = label(nft);
  });

  for (const key in inputNFTMap) {
    if (!isDefined(outputNFTMap[key])) {
      throw new Error(`Input NFT ${inputNFTMap[key]} must match NFT output.`);
    }
  }
};
