import { NETWORK_CONFIG, NetworkName } from '@railgun-community/shared-models';
import { AxiosError } from 'axios';
import { getContractAddressesForChainOrThrow } from '@0x/contract-addresses';
import { BigNumber } from '@ethersproject/bignumber';
import { parseUnits } from '@ethersproject/units';
import { getZeroXData, ZeroXApiEndpoint } from './zero-x-fetch';
import { RecipeERC20Amount, RecipeERC20Info } from '../../models/export-models';
import { PopulatedTransaction } from '@ethersproject/contracts';

export const ZERO_X_PRICE_DECIMALS = 18;

type ZeroXAPIPriceData = {
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

type ZeroXAPIQuoteParams = {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  slippagePercentage: string;
};

export type ZeroXSwapQuoteParams = {
  networkName: NetworkName;
  sellERC20Amount: RecipeERC20Amount;
  buyERC20Info: RecipeERC20Info;
  slippagePercentage: number;
};

export type ZeroXSwapQuoteData = {
  price: BigNumber;
  guaranteedPrice: BigNumber;
  buyERC20Amount: RecipeERC20Amount;
  minimumBuyAmount: BigNumber;
  spender: Optional<string>;
  populatedTransaction: PopulatedTransaction;
  slippagePercentage: number;
  sellTokenAddress: string;
  sellTokenValue: string;
};

const NULL_SPENDER_ADDRESS = '0x0000000000000000000000000000000000000000';

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
  sellERC20Amount,
  buyERC20Info,
  slippagePercentage,
}: ZeroXSwapQuoteParams): Promise<ZeroXSwapQuoteData> => {
  const sellAmount = sellERC20Amount.amount.toString();
  if (sellAmount === '0') {
    throw new Error('Swap sell amount is 0.');
  }
  const sellTokenAddress = getZeroXTokenAddress(sellERC20Amount);
  const buyTokenAddress = getZeroXTokenAddress(buyERC20Info);
  if (sellTokenAddress === buyTokenAddress) {
    throw new Error('Swap sell and buy tokens are the same.');
  }
  const params: ZeroXAPIQuoteParams = {
    sellToken: sellTokenAddress,
    buyToken: buyTokenAddress,
    sellAmount,
    slippagePercentage: String(slippagePercentage),
  };

  try {
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
    } = await getZeroXData<ZeroXAPIPriceData>(
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
      throw invalidError;
    }

    const minimumBuyAmount = BigNumber.from(buyAmount)
      .mul(10000 - slippagePercentage * 10000)
      .div(10000);
    const populatedTransaction: PopulatedTransaction = {
      to: to,
      data: data,
      value: BigNumber.from(value),
    };
    const spender: Optional<string> =
      allowanceTarget === NULL_SPENDER_ADDRESS ? undefined : allowanceTarget;

    return {
      price: parseUnits(price, ZERO_X_PRICE_DECIMALS),
      guaranteedPrice: parseUnits(guaranteedPrice, ZERO_X_PRICE_DECIMALS),
      buyERC20Amount: {
        ...buyERC20Info,
        amount: BigNumber.from(buyAmount),
      },
      minimumBuyAmount,
      spender,
      populatedTransaction,
      slippagePercentage,
      sellTokenAddress: sellTokenAddressResponse,
      sellTokenValue: sellTokenValueResponse,
    };
  } catch (err) {
    const msg = formatApiError(err);
    throw new Error(msg);
  }
};

const formatApiError = (err: AxiosError<any> | Error): string => {
  if (!(err instanceof AxiosError)) {
    return err.message;
  }
  try {
    // Axios Errors come back as 400 with this format:
    // err.response.data.reason
    // err.response.data.validationErrors[].reason

    const { response } = err as AxiosError<any>;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data = response?.data;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const firstValidationErrorReason = data?.validationErrors[0].reason;

    if (firstValidationErrorReason === 'INSUFFICIENT_ASSET_LIQUIDITY') {
      return 'Insufficient liquidity. One of the selected tokens is not supported by the 0x Exchange.';
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return `0x Exchange: ${response?.data.reason}. ${firstValidationErrorReason}.`;
  } catch {
    return '0x API request failed.';
  }
};
