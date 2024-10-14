import {
  isDefined,
  NETWORK_CONFIG,
  NetworkName,
} from '@railgun-community/shared-models';
import type {
  RecipeERC20Amount,
  RecipeERC20Info,
} from '../../models';
import { V2QuoteParams, V2SwapQuoteParams, ZeroXV2PriceData, SwapQuoteDataV2} from './types';
import { getZeroXV2Data, ZeroXV2ApiEndpoint } from './zero-x-v2-fetch';
import { minBalanceAfterSlippage } from '../../utils/number';
import { formatUnits, parseUnits, type ContractTransaction } from 'ethers';
import { QuoteError } from './errors';

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
      throw QuoteError.from(error);
    }
  };
}