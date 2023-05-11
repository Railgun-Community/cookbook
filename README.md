[![Unit Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)
[![Integration Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/integration-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)

# RAILGUN Cookbook

Write a recipe in minutes to convert your dApp to a zkApp.

## Get the Recipe Builder

`yarn add @railgun-community/cookbook`

## Bake a Recipe and call it with RAILGUN Quickstart

```
// Set up initial parameters.
const sellToken = {tokenAddress: 'DAI'};
const buyToken = {tokenAddress: 'WETH'};
const slippagePercentage = 0.01;

// Use RAILGUN Cookbook to generate auto-validated multi-call transactions from a recipe.
const swap = new ZeroXSwapRecipe(sellToken, buyToken, slippagePercentage);

// Pass inputs that will be unshielded from private balance.
const amount = BigNumber.from(10).pow(18).mul(3000); // 3000 DAI
const unshieldERC20Amounts = [{ tokenAddress: 'DAI', amount }];
const recipeInput = {networkName, unshieldERC20Amounts};
const {populatedTransactions, shieldERC20Addresses} = await swap.getRecipeOutput(recipeInput);

// Use RAILGUN Quickstart to generate a private [unshield -> call -> re-shield] enclosing the recipe.
const crossContractCallsSerialized = populatedTransactions.map(
    serializeUnsignedTransaction,
)
const {gasEstimateString} = await gasEstimateForUnprovenCrossContractCalls(
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

## Unit tests

`yarn test` to run tests without Ganache Fork.

## Integration tests (beta)

### Setup:

1. Set up anvil (install foundryup):

`curl -L https://foundry.paradigm.xyz | bash`

2. Add an Ethereum RPC for fork (Alchemy recommended for best stability): `export ETHEREUM_RPC_URL='your/rpc/url'`

### Run all tests:

1. Run anvil fork and load test account with 1000 ETH: `./run-anvil your/ethereum/rpc/url`

2. Run tests (in another terminal): `yarn test-fork`.

### Debugging:

If you get a cross-contract call error (transaction failure), try running `debug_traceCall` against the Anvil RPC:

```
curl http://localhost:8600 -X POST \
    -H "Content-Type: application/json" \
  --data '{"method":"debug_traceCall","params":[{"from":null,"to":"ENTER_TO_0x","data":"ENTER_DATA_0x"}, "latest"],"id":1,"jsonrpc":"2.0"}'
```
