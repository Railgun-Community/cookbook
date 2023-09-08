## Query

<!-- QUERY ALL PAIRS >$100 USD RESERVES -->

curl -L -H "Content-Type: application/json" -X POST -d '{ "query": "query Pairs { pairs(first: 1000, orderBy:reserveUSD, orderDirection:desc, where: {reserveUSD_gt: 100}) { id token0 { id symbol decimals } token1 { id symbol decimals } }}"}' [URL]

## URLs

<!-- UNISWAP V2 ETH -->

https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v2-dev

<!-- SUSHISWAP V2 ETH -->

https://api.thegraph.com/subgraphs/name/sushiswap/exchange

<!-- SUSHISWAP V2 POLYGON -->

https://api.thegraph.com/subgraphs/name/sushiswap/matic-exchange

<!-- SUSHISWAP V2 BSC -->

https://api.thegraph.com/subgraphs/name/sushiswap/bsc-exchange

<!-- SUSHISWAP V2 ARBITRUM -->

https://api.thegraph.com/subgraphs/name/sushiswap/arbitrum-exchange

<!-- PANCAKESWAP V2 BSC -->

https://api.thegraph.com/subgraphs/name/ord786/pancakeswap

<!-- QUICKSWAP V2 POLYGON -->

https://api.thegraph.com/subgraphs/name/shivannguyen/quickswap-matic2

## How to update lists:

1. Run full query against proper URL.
2. Remove "data" and "pairs" fields to get final array
