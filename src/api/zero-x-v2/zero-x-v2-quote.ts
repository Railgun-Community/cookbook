import {
  isDefined,
  NETWORK_CONFIG,
  NetworkName,
} from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
  SwapQuoteData,
} from '../../models';
import { getZeroXV2Data, ZeroXV2ApiEndpoint } from './zero-x-v2-fetch';
import { minBalanceAfterSlippage } from '../../utils/number';
import { formatUnits, parseUnits, type ContractTransaction } from 'ethers';
import { AxiosError } from 'axios';

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

export type V2SwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippageBasisPoints: number;
  isRailgun: boolean;
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
    return erc20.tokenAddress;
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
    const sellTokenAddress = this.getZeroXTokenAddress(sellERC20Amount);
    const buyTokenAddress = this.getZeroXTokenAddress(buyERC20Info);

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

  private static getZeroXV2QuoteInvalidError = (
    networkName: NetworkName,
    to: string,
    sellTokenAddress: string,
    buyTokenAddress: string,
  ): undefined | unknown => {
    try {
      const exchangeAllowanceHolderAddress =
        // this is not correct, this is the spender that needs to have allowance set to.
        // need to write a new function out or get the updated addresses from 0x sdk?
        this.zeroXExchangeAllowanceHolderAddress(networkName);
      if (
        ![
          exchangeAllowanceHolderAddress.toLowerCase(),
          sellTokenAddress.toLowerCase(),
          buyTokenAddress.toLowerCase(),
        ].includes(to.toLowerCase())
      ) {
        throw new Error(
          `Invalid 0x V2 Exchange contract address: ${to} vs ${exchangeAllowanceHolderAddress}`,
        );
      }
      return undefined;
    } catch (error: unknown) {
      return error;
    }
  };

  private static formatV2ApiError = (error: AxiosError<any> | Error) => {
    try {
      if (!(error instanceof AxiosError)) {
        return error.message;
      }
      const { response } = error as AxiosError<any>;
      if (!response) {
        return `0x V2 API request failed: ${error.message}.`;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { data } = response;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { name: firstDetailsErrorReason } = data;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment

      if (firstDetailsErrorReason === 'TOKEN_NOT_SUPPORTED') {
        return 'One of the selected tokens is not supported by the 0x Exchange.';
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (isDefined(data.data.details)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const firstDetailsError = data.data.details[0];
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return `0x V2 Exchange: ${firstDetailsError.field}:${firstDetailsError.reason}. ${firstDetailsErrorReason}.`;
      }
      return `0x V2 API request failed: ${firstDetailsErrorReason}`;
    } catch {
      return `0x V2 API request failed: ${error.message}.`;
    }
  };

  static getSwapQuote = async ({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints,
    isRailgun,
  }: V2SwapQuoteParams): Promise<SwapQuoteDataV2> => {
    const params = ZeroXV2Quote.getQuoteParams(
      networkName,
      sellERC20Amount,
      buyERC20Info,
      slippageBasisPoints,
    );

    try {
      const response = await getZeroXV2Data<ZeroXV2PriceData>(
        ZeroXV2ApiEndpoint.GetSwapQuote,
        isRailgun,
        params,
      );

      const invalidError = this.getZeroXV2QuoteInvalidError(
        networkName,
        response.transaction.to,
        params.sellToken,
        params.buyToken,
      );
      if (isDefined(invalidError)) {
        throw invalidError;
      }
      const { issues, buyAmount } = response;

      // auto set slippage of 100 bps if none is found.
      const minimumBuyAmount = minBalanceAfterSlippage(
        BigInt(response.buyAmount),
        BigInt(params?.slippageBps ?? 100),
      );

      const crossContractCall: ContractTransaction = {
        to: response.transaction.to,
        data: response.transaction.data,
        value: BigInt(response.transaction.value),
      };

      const spender =
        // allowance is null sometimes coming back from api, need to check this.
        // if it comes back; use its value. if not use the hardcoded value.
        issues.allowance !== null
          ? issues.allowance.spender
          : // according to the api, this is standard across the chains we support.
            this.zeroXExchangeAllowanceHolderAddress(networkName);

      // calculate a price based on the current buy amount and sell amount.

      const priceBuyAmount = parseFloat(
        formatUnits(buyAmount, buyERC20Info.decimals),
      );
      const minPriceBuyAmount = parseFloat(
        formatUnits(minimumBuyAmount, buyERC20Info.decimals),
      );
      const priceSellAmount = parseFloat(
        formatUnits(sellERC20Amount.amount, sellERC20Amount.decimals),
      );

      const price = parseUnits(
        (priceBuyAmount / priceSellAmount).toFixed(8),
        sellERC20Amount.decimals,
      );
      const guaranteedPrice = parseUnits(
        (minPriceBuyAmount / priceSellAmount).toFixed(8),
        sellERC20Amount.decimals,
      );

      return {
        price, // manually calculated
        guaranteedPrice, // manually calculated
        buyERC20Amount: {
          ...buyERC20Info,
          amount: BigInt(buyAmount),
        },
        minimumBuyAmount,
        spender: spender as Optional<string>,
        crossContractCall,
        slippageBasisPoints: BigInt(slippageBasisPoints),
        sellTokenAddress: response.sellToken,
        sellTokenValue: response.sellAmount,
        zid: response.zid,
      };
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const errorMessage = this.formatV2ApiError(error); // need to format this error message
      console.log(errorMessage);
      throw new Error(`Error fetching 0x V2 swap quote:`, {
        cause: new Error(errorMessage),
      });
    }
  };
}

export type SwapQuoteDataV2 = SwapQuoteData & {
  zid: string;
};
