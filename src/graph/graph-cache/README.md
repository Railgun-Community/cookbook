## Query

<!-- QUERY ALL PAIRS >$100 USD RESERVES -->

curl -L -H "Content-Type: application/json" -X POST -d '{ "query": "query Pairs { pairs(first: 1000, orderBy:reserveUSD, orderDirection:desc, where: {reserveUSD_gt: 100}) { id token0 { id symbol decimals } token1 { id symbol decimals } }}"}' [URL]

## URLs

<!-- UNISWAP V2 ETH -->

https://gateway.thegraph.com/api/{THE_GRAPH_API_KEY}/subgraphs/id/EYCKATKGBKLWvSfwvBjzfCBmGwYNdVkduYXVivCsLRFu

<!-- SUSHISWAP V2 ETH -->

https://gateway.thegraph.com/api/{THE_GRAPH_API_KEY}/subgraphs/id/6NUtT5mGjZ1tSshKLf5Q3uEEJtjBZJo1TpL5MXsUBqrT

<!-- SUSHISWAP V2 POLYGON -->

https://gateway.thegraph.com/api/{THE_GRAPH_API_KEY}/subgraphs/id/8NiXkxLRT3R22vpwLB4DXttpEf3X1LrKhe4T1tQ3jjbP

<!-- SUSHISWAP V2 BSC -->

https://gateway.thegraph.com/api/{THE_GRAPH_API_KEY}/subgraphs/id/GPRigpbNuPkxkwpSbDuYXbikodNJfurc1LCENLzboWer

<!-- SUSHISWAP V2 ARBITRUM -->

https://gateway.thegraph.com/api/{THE_GRAPH_API_KEY}/subgraphs/id/8nFDCAhdnJQEhQF3ZRnfWkJ6FkRsfAiiVabVn4eGoAZH

<!-- PANCAKESWAP V2 BSC -->

https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/Aj9TDh9SPcn7cz4DXW26ga22VnBzHhPVuKGmE4YBzDFj

<!-- QUICKSWAP V2 POLYGON -->

https://gateway.thegraph.com/api/${THE_GRAPH_API_KEY}/subgraphs/id/CCFSaj7uS128wazXMdxdnbGA3YQnND9yBdHjPtvH7Bc7

## How to update lists:

1. Run full query against proper URL.
2. Remove "data" and "pairs" fields to get final array
