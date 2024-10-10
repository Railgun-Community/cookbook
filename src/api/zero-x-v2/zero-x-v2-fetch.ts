type SearchParams = {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
};

enum ZeroXV2ApiEndpoint {
  GetSwapQuote = 'swap/allowance-holder/quote',
  GetSwapPrice = 'swap/allowance-holder/price',
}

const getSearchV2Params = (params: SearchParams) => {
  const searchParams = new URLSearchParams(params);
  return searchParams.toString() ? `?${searchParams.toString()}` : '';
};
