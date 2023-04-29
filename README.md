[![Node.js CI Actions Status](https://github.com/Railgun-Community/waku-relayer-client/actions/workflows/node.js.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/waku-relayer-client/actions)

# RAILGUN Relayer Client with Waku networking layer

Compatible with Browser and NodeJS environments.

`yarn add @railgun-community/waku-relayer-client`

## The Basics

```
// Initialize the Relayer Client
await RailgunWakuRelayerClient.start(...)

// Wait for Relayers to connect (5-10 sec) and client to collect fees.
// Relayers broadcast fees through the privacy-safe Waku network.

// Get relayer with lowest fee for a given ERC20 token.
const selectedRelayer = await RailgunWakuRelayerClient.findBestRelayer(...)

// Create Relayed transaction and send through selected Relayer.
const relayerTransaction = await RelayerTransaction.create(...)
await RelayerTransaction.send(...)
```
