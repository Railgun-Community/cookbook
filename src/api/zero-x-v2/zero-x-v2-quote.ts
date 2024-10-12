import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import type { RecipeERC20Amount, RecipeERC20Info } from '../../models';

export type V2BaseAPIParams = {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
};

export type V2QuoteParams = V2BaseAPIParams & {
  taker: string;
  txOrigin: string; // The contract address of the external account that started the transaction. This is only needed if taker is a smart contract.
  slippageBps?: number; //Default: 100 - The maximum acceptable slippage of the buyToken in Bps. If this parameter is set to 0, no slippage will be tolerated. If not provided, the default slippage tolerance is 100Bps
};

type ZeroXV2Transaction = {
  to: string;
  data: string;
  value: string;
  gasPrice: string;
  gas: string;
};

type ZeroXV2Allowance = {
  actual: string; //The taker's current allowance of the spender
  spender: string; //The address to set the allowance on
};

type ZeroXV2Balance = {
  token: string; // The contract address of the sellToken
  actual: string; // The current balance of the sellToken in the taker address
  expected: string; // The balance of the sellToken required for the swap to execute successfully
};

type ZeroXV2Issues = {
  allowance: ZeroXV2Allowance;
  balance: ZeroXV2Balance;
  simulationIncomplete: boolean; //This is set to true when 0x cannot validate the transaction. This happens when the taker has an insufficient balance of the sellToken and 0x is unable to peform ehanced quote validation with the low balance. Note that this does not necessarily mean that the trade will revert
  invalidSourcesPassed: string[]; // A list of invalid sources present in excludedSources request. See https://api.0x.org/sources?chainId= with the desired chain's ID for the list of valid sources
};

type ZeroXV2PriceData = {
  buyAmount: string;
  minBuyAmount: string;
  sellAmount: string;
  sellToken: string;
  transaction: ZeroXV2Transaction;
  liquidityAvailable: boolean; // This validates the availability of liquidity for the quote requested. The rest of the fields will only be returned if true
  zid: string; // The unique ZeroEx identifier of the request
  issues: ZeroXV2Issues;
};

const NULL_SPENDER_ADDRESS = '0x0000000000000000000000000000000000000000';

const ZERO_X_PROXY_BASE_TOKEN_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export class ZeroXV2Quote {
  private static getZeroXTokenAddress = (erc20: RecipeERC20Info) => {
    if (erc20.isBaseToken ?? false) {
      return ZERO_X_PROXY_BASE_TOKEN_ADDRESS;
    }
  };

  static zeroXExchangeAllowanceHolderAddress = (networkName: NetworkName) => {
    switch (networkName) {
      case NetworkName.Ethereum:
      case NetworkName.BNBChain:
      case NetworkName.Polygon:
      case NetworkName.Arbitrum: {
        return '0x0000000000001fF3684f28c67538d4D072C22734';
      }
      default: {
        throw new Error(
          `No 0x V2 Exchange Proxy contract address for chain ${networkName}`,
        );
      }
    }
  };

  static supportsNetwork = (networkName: NetworkName) => {
    try {
      this.zeroXExchangeAllowanceHolderAddress(networkName);
      return true;
    } catch {
      return false;
    }
  };
  static getQuoteParams = (
    networkName: NetworkName,
    sellERC20Amount: RecipeERC20Amount,
    buyERC20Info: RecipeERC20Info,
    slippageBasisPoints: number,
  ): V2QuoteParams => {
    if (sellERC20Amount.amount === 0n) {
      throw new Error('Swap sell amount is 0.');
    }

    const { relayAdaptContract, chain } = NETWORK_CONFIG[networkName];
    const sellTokenAddress = sellERC20Amount.tokenAddress;
    const buyTokenAddress = buyERC20Info.tokenAddress;

    if (sellTokenAddress === buyTokenAddress) {
      throw new Error('Swap sell and buy tokens are the same.');
    }
    const params: V2QuoteParams = {
      chainId: chain.id.toString(),
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      sellAmount: sellERC20Amount.amount.toString(),
      taker: relayAdaptContract,
      txOrigin: relayAdaptContract,
      slippageBps: slippageBasisPoints,
    };
    return params;
  };
}
