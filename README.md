[![Unit Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)
[![Integration Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/integration-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)

# RAILGUN Cookbook

Write a recipe in minutes to convert your dApp to a zkApp.

## Full Documentation

Coming soon

## Get the Recipe Builder

`yarn add @railgun-community/cookbook`

## Write your own zkApp

The RAILGUN Cookbook gives you the tools to write a "Recipe" to convert your dApp into a zkApp - [private and fully anonymous](https://docs.railgun.org/wiki/learn/privacy-system) for users. Your Recipe can interact with any smart contract using your private balance in [RAILGUN](https://docs.railgun.org/wiki/learn/overview). A Recipe contains a series of smart contact calls that are combined into a multicall.

### Cookbook "Steps"

Recipes are composed of "Steps," which are enclosed smart contract calls. Every Step has a set of inputs that correspond to a set of outputs: Spent tokens, Output tokens, and Fees. Spent tokens and Fees are eradicated during the Step, and Output tokens will be passed into the next Step as inputs.

For example, a simple swap Step will contain a Sell Token as an input, and the outputs will include Sell Token (Spent), Buy Token (Output) and no associated Fees.

Step inputs and outputs are validated to ensure that each input has associated outputs that represent the total value. There is an exception for tokens that are generated mid-Step - new token values become unvalidated Output tokens - they are simply passed to the next Step as inputs.

### Cookbook "Recipes"

Recipes combine Steps into functional, complex actions. Most integrations will require 1-2 Recipes, and a number of Steps for each Recipe. Steps are generic building blocks, making them multi-purpose and reusable for various Recipes. Upon execution (`recipe.getRecipeOutput(recipeInput)`), the Cookbook automatically sandwiches the Recipe's transactions inside of Unshield/Shield calls, automatically calculating the associated fees with each Step, and providing the developer with a formatted list of Steps, their outputs, and the final array of populated transactions.

As an example, a simple 0x Exchange Swap call has a pre-requisite: the Sell Token must be approved for spending by the 0x contract. So, the 0x Swap Recipe (see "zero-x-swap-recipe.ts") has two Steps: (1) Approve sell token, (2) Swap sell token for buy token. The full Recipe uses a Step called ApproveERC20SpenderStep, which is a common Step in most integrations.

Note that each Recipe must assume a clean slate – since it's executed in a public setting (the RAILGUN Relay Adapt Contract), developers should assume that the Relay Adapt contract does not have approval to spend tokens with any token contract. This is why the ApproveERC20SpenderStep is a basic requirement for nearly every Recipe.

### Cookbook "Combo Meals"

Combo Meals are the final frontier – every zkApp Chef's dream. They combine Recipes into very complex interactions, made 100% safe for execution against a private balance using the Cookbook.

For example, there is a Combo Meal that combines an "Add Liquidity" Recipe for Uniswap, with a "Deposit Vault" Recipe for Beefy. This gives a user the ability to add liquidity for a token pair on Uniswap, gain the LP token for that pair, and then deposit the LP token into a Beefy Vault to earn yield.

This all occurs in a single validated transaction call, saving network fees and making the user experience simple and delightful.

## Cook up a Recipe for the RAILGUN Quickstart SDK

Given a full Recipe and its inputs, [RAILGUN Quickstart](https://docs.railgun.org/developer-guide/quickstart/overview) will generate a [zero-knowledge proof](https://docs.railgun.org/wiki/learn/privacy-system/zero-knowledge-cryptography) and a final serialized transaction for the RAILGUN Relay Adapt contract.

This final transaction can be submitted to the blockchain by any wallet, including a [Relayer](https://docs.railgun.org/wiki/learn/privacy-system/community-relayers).

```
const swap = new ZeroXSwapRecipe(sellERC20Info, buyERC20Info, slippagePercentage);

// Inputs that will be unshielded from private balance.
const unshieldERC20Amounts = [{ ...sellERC20Info, amount }];

const recipeInput = { networkName, unshieldERC20Amounts };
const { populatedTransactions, erc20Amounts } = await swap.getRecipeOutput(recipeInput);

// Outputs to re-shield after the Recipe multicall.
const shieldERC20Addresses = erc20Amounts.map(({tokenAddress}) => tokenAddress);

// RAILGUN Quickstart will generate a [unshield -> call -> re-shield] transaction enclosing the Recipe multicall.
const crossContractCallsSerialized = populatedTransactions.map(
    serializeUnsignedTransaction,
)

const {gasEstimateString} = await gasEstimateForUnprovenCrossContractCalls(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCallsSerialized,
    ...
)
await generateCrossContractCallsProof(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCallsSerialized,
    ...
)
const {serializedTransaction} = await populateProvedCrossContractCalls(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCallsSerialized,
    ...
);

// Submit transaction to RPC.
const transaction = deserializeTransaction(serializedTransaction);
await wallet.sendTransaction(transaction);

// Note: use @railgun-community/waku-relayer-client to submit through a Relayer instead of signing with your own wallet.
```

# Testing

## Unit tests

`yarn test` to run tests without RPC Fork.

## Integration tests with RPC Fork

### Setup:

1. Set up anvil (install foundryup): `curl -L https://foundry.paradigm.xyz | bash`

2. Add an Ethereum RPC for fork (Alchemy recommended for best stability): `export ETHEREUM_RPC_URL='your/rpc/url'`

### Run all tests:

1. Run anvil fork and load test account with 1000 ETH: `./run-anvil your/ethereum/rpc/url`

2. Run tests (in another terminal): `yarn test-fork`.
