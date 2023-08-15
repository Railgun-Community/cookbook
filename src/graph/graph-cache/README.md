## Query

<!-- QUERY ALL PAIRS >$100 USD RESERVES -->

curl -L -H "Content-Type: application/json" -X POST -d '{ "query": "query Pairs { pairs(first: 1000, orderBy:reserveUSD, orderDirection:desc, where: {reserveUSD_gt: 100}) { id token0 { id symbol decimals } token1 { id symbol decimals } }}"}' [URL]

## URLs

<!-- UNISWAP ETH -->

https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2

<!-- SUSHISWAP ETH -->

https://api.thegraph.com/subgraphs/name/sushiswap/exchange

<!-- SUSHISWAP POLYGON -->

https://api.thegraph.com/subgraphs/name/sushiswap/matic-exchange

<!-- SUSHISWAP BSC -->

https://api.thegraph.com/subgraphs/name/sushiswap/bsc-exchange

<!-- SUSHISWAP ARBITRUM -->

https://api.thegraph.com/subgraphs/name/sushiswap/arbitrum-exchange

## How to update lists:

1. Run full query against proper URL. If you get 'indexing_error', the data source is currently unavailable. Try again later.
2. Remove "data" and "pairs" fields to get final array
