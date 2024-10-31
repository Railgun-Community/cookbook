import {
  isDefined,
  NETWORK_CONFIG,
  NetworkName,
} from '@railgun-community/shared-models';
import type {
  QuoteParamsV2,
  RecipeERC20Amount,
  RecipeERC20Info,
  SwapQuoteDataV2,
  SwapQuoteParamsV2,
  ZeroXV2PriceData,
} from '../../models';
import { getZeroXV2Data, ZeroXV2ApiEndpoint } from './zero-x-v2-fetch';
import { minBalanceAfterSlippage } from '../../utils/number';
import { formatUnits, parseUnits, type ContractTransaction } from 'ethers';
import { InvalidExchangeContractError, SwapQuoteError, InvalidProxyContractChainError, QuoteParamsError, NoLiquidityError } from './errors';
import { ZERO_X_EXCHANGE_ALLOWANCE_HOLDER_ADDRESS, ZERO_X_PROXY_BASE_TOKEN_ADDRESS } from '../../models/constants';

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
        return ZERO_X_EXCHANGE_ALLOWANCE_HOLDER_ADDRESS;
      }
      default: {
        throw new InvalidProxyContractChainError(networkName);
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
    activeWalletAddress: Optional<string>,
  ): QuoteParamsV2 => {
    if (sellERC20Amount.amount === 0n) {
      throw new QuoteParamsError('Swap sell amount is 0.');
    }

    const { relayAdaptContract, chain } = NETWORK_CONFIG[networkName];
    const sellTokenAddress = this.getZeroXTokenAddress(sellERC20Amount);
    const buyTokenAddress = this.getZeroXTokenAddress(buyERC20Info);

    if (sellTokenAddress === buyTokenAddress) {
      throw new QuoteParamsError('Swap sell and buy tokens are the same');
    }

    const params: QuoteParamsV2 = {
      chainId: chain.id.toString(),
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      sellAmount: sellERC20Amount.amount.toString(),
      taker: activeWalletAddress ?? relayAdaptContract,
      txOrigin: activeWalletAddress ?? relayAdaptContract,
      slippageBps: slippageBasisPoints,
      excludedSources: "0x_RFQ,Uniswap_V3"
    };
    return params;
  };
  

  private static isValidQuote = (
    networkName: NetworkName,
    response: ZeroXV2PriceData,
    sellTokenAddress: string,
    buyTokenAddress: string,
  ): void => {
  
    if(!response.liquidityAvailable){
      throw new Error('No liquidity available for this trade');
    }
    const { to } = response.transaction;
    if( !isDefined(to) ){
      throw new InvalidExchangeContractError(to, this.zeroXExchangeAllowanceHolderAddress(networkName));
    }
      const exchangeAllowanceHolderAddress =
        // this is not correct, this is the spender that needs to have allowance set to.
        // need to write a new function out or get the updated addresses from 0x sdk?
        this.zeroXExchangeAllowanceHolderAddress(networkName);

      const validAddresses = [
          exchangeAllowanceHolderAddress,
          sellTokenAddress,
          buyTokenAddress
        ].map(addr => addr.toLowerCase());

        if (!validAddresses.includes(to.toLowerCase())) {
          throw new InvalidExchangeContractError(to, exchangeAllowanceHolderAddress);
        }

  };

  static getSwapQuote = async ({
    networkName,
    sellERC20Amount,
    buyERC20Info,
    slippageBasisPoints,
    isRailgun,
    activeWalletAddress,
  }: SwapQuoteParamsV2): Promise<SwapQuoteDataV2> => {
    const params = ZeroXV2Quote.getQuoteParams(
      networkName,
      sellERC20Amount,
      buyERC20Info,
      slippageBasisPoints,
      isRailgun ? undefined : activeWalletAddress
    );

    try {
      const response = await getZeroXV2Data<ZeroXV2PriceData>(
        ZeroXV2ApiEndpoint.GetSwapQuote,
        isRailgun,
        params,
      );

      const { liquidityAvailable } = response;

      if (!liquidityAvailable) {
        throw new NoLiquidityError();
      }

      this.isValidQuote(
        networkName,
        response,
        params.sellToken,
        params.buyToken,
      );
      
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

      const minDecimalFixedInt = parseInt(sellERC20Amount.decimals.toString());
      const price = parseUnits(
        (priceBuyAmount / priceSellAmount).toFixed(minDecimalFixedInt),
        sellERC20Amount.decimals,
      );
      const guaranteedPrice = parseUnits(
        (minPriceBuyAmount / priceSellAmount).toFixed(minDecimalFixedInt),
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
      throw SwapQuoteError.from(error);
    }
  };
}
