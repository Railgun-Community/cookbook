[![Unit Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions)

<!-- [![Integration Tests Actions Status](https://github.com/Railgun-Community/cookbook/actions/workflows/integration-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/cookbook/actions) -->

# RAILGUN Cookbook

Write a Recipe in minutes to convert your dApp to a zkApp.

## Docs and Integration Guide

See the full Integration Guide [here](https://docs.railgun.org/developer-guide/cookbook).

## Get the Recipe Builder

`yarn add @railgun-community/cookbook`

## Write your own zkApp

The RAILGUN Cookbook gives you the tools to write a "Recipe" to convert your dApp into a zkApp - [private and fully anonymous](https://docs.railgun.org/wiki/learn/privacy-system) for users. Your Recipe can interact with any smart contract using your private balance in [RAILGUN](https://docs.railgun.org/wiki/learn/overview). A Recipe contains a series of smart contact calls that are combined into a multicall.

See the [full zkApp guide here](https://docs.railgun.org/developer-guide/cookbook/write).

### Create a new ["Step"](https://docs.railgun.org/developer-guide/cookbook/write/step)

Recipes are composed of "Steps," which are enclosed smart contract calls. Every Step has a set of inputs that correspond to a set of outputs: Spent tokens, Output tokens, and Fees. Spent tokens and Fees are eradicated during the Step, and Output tokens will be passed into the next Step as inputs.

For example, a simple [0x Exchange Swap Step](https://github.com/Railgun-Community/cookbook/blob/main/src/steps/swap/zero-x/zero-x-swap-step.ts) will contain a Sell Token as an input, and the outputs will include Sell Token (Spent), Buy Token (Output) and no associated Fees.

Step inputs and outputs are automatically validated to ensure that each input has associated outputs that represent the total value. There is an exception for tokens that are generated mid-Step - new token values become unvalidated Output tokens - they are simply passed to the next Step as inputs.

### Convert Steps into a ["Recipe"](https://docs.railgun.org/developer-guide/cookbook/write/recipe)

Recipes combine Steps into functional, complex actions. Most integrations will require 1-2 Recipes, and a number of Steps for each Recipe. Steps are generic building blocks, making them multi-purpose and reusable for various Recipes. Upon execution (`recipe.getRecipeOutput(recipeInput)`), the Cookbook automatically sandwiches the Recipe's transactions inside of [Unshield](https://docs.railgun.org/wiki/learn/unshielding-tokens) and [Shield](https://docs.railgun.org/wiki/learn/shielding-tokens) calls, calculating the associated fees with each Step, and providing the developer with a formatted list of Steps, their outputs, and the final array of [populated transactions](https://docs.ethers.org/v5/api/utils/transactions/).

As an example, a simple 0x Exchange Swap call has a pre-requisite: the Sell Token must be approved for spending by the 0x contract. So, the [0x Swap Recipe](https://github.com/Railgun-Community/cookbook/blob/main/src/recipes/swap/zero-x-swap-recipe.ts) has two Steps: (1) Approve sell token, (2) Swap sell token for buy token. The full Recipe uses a Step called [ApproveERC20SpenderStep](https://github.com/Railgun-Community/cookbook/blob/main/src/steps/token/erc20/approve-erc20-spender-step.ts), which is a common Step among most integrations.

> Note that each Recipe must assume a clean slate – since it's executed in a public setting (the RAILGUN Relay Adapt Contract), developers should assume that the Relay Adapt contract does not have approval to spend tokens with any token contract. This is why the [ApproveERC20SpenderStep](https://github.com/Railgun-Community/cookbook/blob/main/src/steps/token/erc20/approve-erc20-spender-step.ts) is a basic requirement for nearly every Recipe.

### Combine Recipes into a ["Combo Meal"](https://docs.railgun.org/developer-guide/cookbook/write/combo-meals)

Combo Meals are the final frontier – every zkApp Chef's dream. They combine Recipes into very complex interactions, made 100% safe for execution against a private balance using the Cookbook.

For example, there is a [Combo Meal](https://github.com/Railgun-Community/cookbook/blob/main/src/combo-meals/liquidity-vault/uni-v2-like-add-liquidity-beefy-deposit-combo-meal.ts) that combines an "Add Liquidity" Recipe for Uniswap, with a "Deposit Vault" Recipe for Beefy. This gives a user the ability to add liquidity for a token pair on Uniswap, gain the LP token for that pair, and then deposit the LP token into a Beefy Vault to earn yield.

This all occurs in a single validated transaction call, saving network fees and making the user experience simple and delightful.

## Cook up a Recipe for the RAILGUN Quickstart SDK

Given a full Recipe and its inputs, [RAILGUN Quickstart](https://docs.railgun.org/developer-guide/wallet/overview) will generate a [zero-knowledge proof](https://docs.railgun.org/wiki/learn/privacy-system/zero-knowledge-cryptography) and a final serialized transaction for the RAILGUN Relay Adapt contract.

This final transaction can be submitted to the blockchain by any wallet, including a [Relayer](https://docs.railgun.org/wiki/learn/privacy-system/community-relayers).

```
const swap = new ZeroXSwapRecipe(sellERC20Info, buyERC20Info, slippagePercentage);

// Inputs that will be unshielded from private balance.
const unshieldERC20Amounts = [{ ...sellERC20Info, amount }];

const recipeInput = { networkName, unshieldERC20Amounts };
const { crossContractCalls, erc20Amounts } = await swap.getRecipeOutput(recipeInput);

// Outputs to re-shield after the Recipe multicall.
const shieldERC20Addresses = erc20Amounts.map(({tokenAddress}) => tokenAddress);

// RAILGUN Quickstart will generate a [unshield -> call -> re-shield] transaction enclosing the Recipe multicall.

const {gasEstimate} = await gasEstimateForUnprovenCrossContractCalls(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCalls,
    ...
)
await generateCrossContractCallsProof(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCalls,
    ...
)
const {transaction} = await populateProvedCrossContractCalls(
    ...
    unshieldERC20Amounts,
    ...
    shieldERC20Addresses,
    ...
    crossContractCalls,
    ...
);

// Submit transaction to RPC.
await wallet.sendTransaction(transaction);

// Note: use @railgun-community/waku-relayer-client to submit through a Relayer instead of signing with your own wallet.
```

# Testing

## Unit tests

`yarn test` to run tests without RPC Fork.

## Integration tests with RPC Fork

### Setup:

1. Set up anvil (install [foundryup](https://book.getfoundry.sh/getting-started/installation)): `curl -L https://foundry.paradigm.xyz | bash`

2. Add an Ethereum RPC for fork: `export ETHEREUM_RPC_URL='your/rpc/url'`

### Run fork tests:

1. Fork tests currently support networks: Ethereum, Arbitrum

2. Run anvil fork with an RPC URL and load test account with 1000 ETH: `./run-anvil Ethereum https://your/ethereum/rpc/url`

- See [Chainlist](https://chainlist.org/) or [Pokt](https://docs.pokt.network/use/public-rpc/) for public RPC endpoints (however paid RPCs are recommended for stability).

3. Run tests (in another terminal): `env NETWORK_NAME=Ethereum yarn test-fork`.
