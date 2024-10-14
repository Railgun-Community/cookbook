import { AxiosError } from 'axios';

interface ZeroXAPIErrorData {
  name: string;
  message: string;
  data?: {
    details?: Array<{
      field: string;
      reason: string;
    }>;
  };
}

export abstract class ZeroXAPIError extends Error {
  override readonly name: string;
  readonly cause: string;

  constructor({ name, cause }: { name: string; cause: string }) {
      super(cause);
      this.name = name;
      this.cause = cause;
      Object.setPrototypeOf(this, ZeroXAPIError.prototype);
  }

  public getCause(): string {
      return this.cause;
  }
};

export class MissingHeadersError extends ZeroXAPIError {
  constructor() {
      super({
          name: 'MissingHeaders',
          cause: 'No 0x API Key is configured. Set ZeroXConfig.API_KEY. For tests, modify test-config-overrides.test.ts.',
      });
  }
};

export class SwapQuoteError extends ZeroXAPIError {
  constructor(cause: string) {
    super({
      name: 'SwapQuoteError',
      cause: `Error fetching 0x V2 swap quote: ${cause}`,
    });
  }

  private static fromAxiosError(error: AxiosError<ZeroXAPIErrorData>): SwapQuoteError {
    const formattedError = SwapQuoteError.formatV2ApiError(error);
    return new SwapQuoteError(formattedError);
  }

  private static formatV2ApiError(error: AxiosError<ZeroXAPIErrorData>): string {
    if (!error.response) {
      return `0x V2 API request failed: ${error.message}.`;
    }

    const { data } = error.response;

    if (data.name === 'TOKEN_NOT_SUPPORTED') {
      return 'One of the selected tokens is not supported by the 0x Exchange.';
    }

    if (data.data?.details && data.data.details.length > 0) {
      const firstDetailsError = data.data.details[0];
      return `0x V2 Exchange: ${firstDetailsError.field}:${firstDetailsError.reason}. ${data.name}.`;
    }

    return `0x V2 API request failed: ${data.name}`;
  }

  static from(error: unknown): SwapQuoteError {
    if (error instanceof AxiosError) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return SwapQuoteError.fromAxiosError(error);
    }
    return new SwapQuoteError(error instanceof Error ? error.message : String(error));
  }
}

export class QuoteParamsError  extends ZeroXAPIError {
  constructor(description: string) {
    super({
        name: 'QuoteParamsError',
        cause: description,
    });
  }
};

export class InvalidExchangeContractError  extends ZeroXAPIError {
  constructor(to: string, exchangeAllowanceHolderAddress: string) {
    super({
        name: 'Invalid0xExchangeContractError',
        cause: `Invalid 0x V2 Exchange contract address: ${to} vs ${exchangeAllowanceHolderAddress}`,
    });
  }
};

export class InvalidProxyContractChainError extends ZeroXAPIError {
  constructor(chain: string) {
    super({
      name: 'InvalidProxyContractChainError',
      cause: `No 0x V2 Exchange Proxy contract address for chain ${chain}`,
    });
  }
};

export class CustomQuoteError extends ZeroXAPIError {

}