import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { AxiosError } from 'axios';
import { getContractAddressesForChainOrThrow } from '@0x/contract-addresses';
import { BigNumber } from '@ethersproject/bignumber';
import { parseUnits } from '@ethersproject/units';
import { getZeroXData, ZeroXApiEndpoint } from './zero-x-fetch';
import {
  RecipeERC20Amount,
  RecipeERC20AmountRecipient,
  RecipeERC20Info,
} from '../../models/export-models';

export const ZERO_X_PRICE_DECIMALS = 18;

type ZeroXPriceData = {
  price: string;
  guaranteedPrice: string;
  buyAmount: string;
  allowanceTarget: string;
  to: string;
  data: string;
  value: string;
  sellTokenAddress: string;
  sellAmount: string;
};

type ZeroXQuoteAPIParams = {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  slippagePercentage: string;
};

export type ZeroXSwapQuoteParams = {
  networkName: NetworkName;
  sellTokenAmount: RecipeERC20Amount;
  buyToken: RecipeERC20Info;
  slippagePercentage: number;
};

export type ZeroXSwapQuoteData = {
  price: BigNumber;
  guaranteedPrice: BigNumber;
  buyERC20AmountRecipient: RecipeERC20AmountRecipient;
  minimumBuyAmount: BigNumber;
  spender: string;
  to: string;
  data: string;
  value: string;
  slippagePercentage: number;
  sellTokenAddress: string;
  sellTokenValue: string;
};

const ZERO_X_PROXY_BASE_TOKEN_ADDRESS =
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const getZeroXTokenAddress = (erc20: RecipeERC20Info) => {
  if (erc20.isBaseToken) {
    return ZERO_X_PROXY_BASE_TOKEN_ADDRESS;
  }
  return erc20.tokenAddress;
};

const zeroXExchangeProxyContractAddress = (networkName: NetworkName) => {
  const { chain } = NETWORK_CONFIG[networkName];
  const addresses = getContractAddressesForChainOrThrow(chain.id);
  return addresses.exchangeProxy;
};

const getZeroXQuoteInvalidError = (
  networkName: NetworkName,
  to: string,
  sellTokenAddress: string,
  buyTokenAddress: string,
): Optional<Error> => {
  try {
    // Validate "to" address.
    const exchangeProxyContractAddress =
      zeroXExchangeProxyContractAddress(networkName);
    if (
      ![
        exchangeProxyContractAddress.toLowerCase(),
        sellTokenAddress.toLowerCase(), // Could be wrapped token contract
        buyTokenAddress.toLowerCase(), // Could be wrapped token contract
      ].includes(to.toLowerCase())
    ) {
      throw new Error(
        `Invalid 0x Exchange contract address: ${to} vs ${exchangeProxyContractAddress}`,
      );
    }

    return undefined;
  } catch (err) {
    return err;
  }
};

export const zeroXGetSwapQuote = async ({
  networkName,
  sellTokenAmount,
  buyToken,
  slippagePercentage,
}: ZeroXSwapQuoteParams): Promise<{
  quote?: ZeroXSwapQuoteData;
  error?: Error;
}> => {
  try {
    const sellAmount = sellTokenAmount.amount.toString();
    if (sellAmount === '0') {
      return {};
    }
    const sellTokenAddress = getZeroXTokenAddress(sellTokenAmount);
    const buyTokenAddress = getZeroXTokenAddress(buyToken);
    if (sellTokenAddress === buyTokenAddress) {
      return {};
    }
    const params: ZeroXQuoteAPIParams = {
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      sellAmount,
      slippagePercentage: String(slippagePercentage),
    };
    const {
      price,
      buyAmount,
      guaranteedPrice,
      allowanceTarget,
      to,
      data,
      value,
      sellTokenAddress: sellTokenAddressResponse,
      sellAmount: sellTokenValueResponse,
    } = await getZeroXData<ZeroXPriceData>(
      ZeroXApiEndpoint.GetSwapQuote,
      networkName,
      params,
    );

    const invalidError = getZeroXQuoteInvalidError(
      networkName,
      to,
      sellTokenAddress,
      buyTokenAddress,
    );
    if (invalidError) {
      return { error: invalidError };
    }

    const minimumBuyAmount = BigNumber.from(buyAmount)
      .mul(10000 - slippagePercentage * 10000)
      .div(10000);

    return {
      quote: {
        price: parseUnits(price, ZERO_X_PRICE_DECIMALS),
        guaranteedPrice: parseUnits(guaranteedPrice, ZERO_X_PRICE_DECIMALS),
        buyERC20AmountRecipient: {
          ...buyToken,
          amount: BigNumber.from(buyAmount),
          recipient: allowanceTarget,
        },
        minimumBuyAmount,
        spender: allowanceTarget,
        to,
        data,
        value,
        slippagePercentage,
        sellTokenAddress: sellTokenAddressResponse,
        sellTokenValue: sellTokenValueResponse,
      },
    };
  } catch (err) {
    const msg = formatApiError(err);
    return {
      error: new Error(msg),
    };
  }
};

const formatApiError = (err: AxiosError<any>): string => {
  try {
    // Errors come back as 400 with this format:
    // err.response.data.reason
    // err.response.data.validationErrors[].reason

    const data = err.response?.data;
    const firstValidationErrorReason = data?.validationErrors[0].reason;

    if (firstValidationErrorReason === 'INSUFFICIENT_ASSET_LIQUIDITY') {
      return 'Insufficient liquidity. One of the selected tokens is not supported by the 0x Exchange.';
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return `0x Exchange: ${err.response?.data.reason}. ${firstValidationErrorReason}.`;
  } catch {
    return '0x API request failed.';
  }
};
