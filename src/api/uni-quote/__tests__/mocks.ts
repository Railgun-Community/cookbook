import { UniswapProtocolType, UniswapQuoteParams } from "../../../models/uni-quote";

export const mockUniswapQuoteParams: UniswapQuoteParams = {
  tokenInChainId: 1,
  tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  tokenOutChainId: 1,
  tokenOut: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  amount: '33000000000000000000',
  slippage: 0.5,
  sendPortionEnabled: false,
  type: 'EXACT_INPUT',
  configs: [
    {
      protocols: [
        UniswapProtocolType.V2,
        UniswapProtocolType.V3,
        UniswapProtocolType.MIXED
      ],
      enableUniversalRouter: true,
      routingType: 'CLASSIC',
      recipient: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // replace with user address here
      enableFeeOnTransferFeeFetching: false,
    },
  ],
};

export const mockUniswapQuoteResponse = {
  "routing": "CLASSIC",
  "quote": {
    "methodParameters": {
      "calldata": "0x24856bc3000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012000000000000000000000000031e8f645be07584c3c62690258eb4ea11e6cb95b000000000000000000000000000000000000000000000001c9f78d2893e40000000000000000000000000000000000000000000000000f9c1b7b7cfa014a6d8500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000646b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000",
      "value": "0x00",
      "to": "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"
    },
    "blockNumber": "18796141",
    "amount": "33000000000000000000",
    "amountDecimals": "33",
    "quote": "74083745480579821710866",
    "quoteDecimals": "74083.745480579821710866",
    "quoteGasAdjusted": "74061242895330762969330",
    "quoteGasAdjustedDecimals": "74061.24289533076296933",
    "gasUseEstimateQuote": "22502585249058741535",
    "gasUseEstimateQuoteDecimals": "22.502585249058741535",
    "gasUseEstimate": "224000",
    "gasUseEstimateUSD": "22.502585249058741535",
    "simulationStatus": "UNATTEMPTED",
    "simulationError": false,
    "gasPriceWei": "44660949226",
    "route": [
      [
        {
          "type": "v3-pool",
          "address": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
          "tokenIn": {
            "chainId": 1,
            "decimals": "18",
            "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "symbol": "WETH"
          },
          "tokenOut": {
            "chainId": 1,
            "decimals": "6",
            "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "symbol": "USDC"
          },
          "fee": "500",
          "liquidity": "16811048132238677300",
          "sqrtRatioX96": "1670122978615670804321995062989705",
          "tickCurrent": "199131",
          "amountIn": "33000000000000000000"
        },
        {
          "type": "v3-pool",
          "address": "0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168",
          "tokenIn": {
            "chainId": 1,
            "decimals": "6",
            "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "symbol": "USDC"
          },
          "tokenOut": {
            "chainId": 1,
            "decimals": "18",
            "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            "symbol": "DAI"
          },
          "fee": "100",
          "liquidity": "454941756906870932698825",
          "sqrtRatioX96": "79231305361984775687897",
          "tickCurrent": "-276324",
          "amountOut": "74083745480579821710866"
        }
      ]
    ],
    "routeString": "[V3] 100.00% = WETH -- 0.05% [0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640] --> USDC -- 0.01% [0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168] --> DAI",
    "quoteId": "047d2d7c-0be7-4019-bcc5-0cf1d07694f8",
    "hitsCachedRoutes": true,
    "requestId": "e51389ed-75bd-4e12-bf85-71ed6c970826",
    "tradeType": "EXACT_INPUT",
    "slippage": 0.5
  },
  "requestId": "e51389ed-75bd-4e12-bf85-71ed6c970826",
  "allQuotes": [
    {
      "routing": "CLASSIC",
      "quote": {
        "methodParameters": {
          "calldata": "0x24856bc3000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012000000000000000000000000031e8f645be07584c3c62690258eb4ea11e6cb95b000000000000000000000000000000000000000000000001c9f78d2893e40000000000000000000000000000000000000000000000000f9c1b7b7cfa014a6d8500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000646b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000",
          "value": "0x00",
          "to": "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"
        },
        "blockNumber": "18796141",
        "amount": "33000000000000000000",
        "amountDecimals": "33",
        "quote": "74083745480579821710866",
        "quoteDecimals": "74083.745480579821710866",
        "quoteGasAdjusted": "74061242895330762969330",
        "quoteGasAdjustedDecimals": "74061.24289533076296933",
        "gasUseEstimateQuote": "22502585249058741535",
        "gasUseEstimateQuoteDecimals": "22.502585249058741535",
        "gasUseEstimate": "224000",
        "gasUseEstimateUSD": "22.502585249058741535",
        "simulationStatus": "UNATTEMPTED",
        "simulationError": false,
        "gasPriceWei": "44660949226",
        "route": [
          [
            {
              "type": "v3-pool",
              "address": "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
              "tokenIn": {
                "chainId": 1,
                "decimals": "18",
                "address": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                "symbol": "WETH"
              },
              "tokenOut": {
                "chainId": 1,
                "decimals": "6",
                "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "symbol": "USDC"
              },
              "fee": "500",
              "liquidity": "16811048132238677300",
              "sqrtRatioX96": "1670122978615670804321995062989705",
              "tickCurrent": "199131",
              "amountIn": "33000000000000000000"
            },
            {
              "type": "v3-pool",
              "address": "0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168",
              "tokenIn": {
                "chainId": 1,
                "decimals": "6",
                "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                "symbol": "USDC"
              },
              "tokenOut": {
                "chainId": 1,
                "decimals": "18",
                "address": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
                "symbol": "DAI"
              },
              "fee": "100",
              "liquidity": "454941756906870932698825",
              "sqrtRatioX96": "79231305361984775687897",
              "tickCurrent": "-276324",
              "amountOut": "74083745480579821710866"
            }
          ]
        ],
        "routeString": "[V3] 100.00% = WETH -- 0.05% [0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640] --> USDC -- 0.01% [0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168] --> DAI",
        "quoteId": "047d2d7c-0be7-4019-bcc5-0cf1d07694f8",
        "hitsCachedRoutes": true,
        "requestId": "e51389ed-75bd-4e12-bf85-71ed6c970826",
        "tradeType": "EXACT_INPUT",
        "slippage": 0.5
      }
    }
  ]
}