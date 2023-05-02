[![Node.js CI Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)

# RAILGUN Cookbook

Write a recipe in minutes to convert your dApp to a zkApp.

## Get the Recipe Builder

`yarn add @railgun-community/cookbook`

## Bake a Recipe and call it with RAILGUN Quickstart

```
// Set up initial parameters.
const networkName = 'Ethereum';
const sellToken = {tokenAddress: 'DAI'};
const buyToken = {tokenAddress: 'WETH'};
const slippagePercentage = 0.01;
const amount = BigNumber.from(10).pow(18).mul(3000); // 3000 DAI
const unshieldERC20Amounts = [{ tokenAddress: 'DAI', amount }];

// Use RAILGUN Cookbook to generate auto-validated multi-call transactions from a recipe.
const swap = new ZeroXSwapRecipe(sellToken, buyToken, slippagePercentage);
const recipeInput = {networkName, unshieldERC20Amounts};
const {populatedTransactions, shieldERC20Addresses} = await swap.getRecipeOutput(recipeInput);

// Use RAILGUN Quickstart to generate a private call enclosing the recipe.
const crossContractCallsSerialized = populatedTransactions.map(
    serializeUnsignedTransaction,
)
const {gasEstimateString} = await generateCrossContractCallsProof(
    ...
    crossContractCallsSerialized,
    ...
)
const {error} = await generateCrossContractCallsProof(
    ...
    crossContractCallsSerialized,
    ...
)
const {serializedTransaction} = await populateProvedCrossContractCalls(
    ...
    crossContractCallsSerialized,
    ...
);

// Submit transaction to RPC.
// Note: use @railgun-community/waku-relayer-client to submit through Relayer.
const transaction = deserializeTransaction(serializedTransaction);
await wallet.sendTransaction(transaction);
```

## Write your own Custom Recipe and Steps

TODO

# Testing

## Run unit tests

`yarn test` to run tests without Hardhat

## Run integration tests

1. Run hardhat Ethereum fork: `npx hardhat node --fork ETHEREUM_RPC_URL` (requires an RPC)
2. Run `yarn test-hardhat` (separate terminal) to trigger all tests, including Hardhat tests.
