import { isDefined } from '@railgun-community/shared-models';
import { AxiosError } from 'axios';

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
export class QuoteError extends ZeroXAPIError {
  constructor(cause: string) {
    super({
      name: 'QuoteError',
      cause: `Error fetching 0x V2 swap quote: ${cause}`,
    });
  }

  static from(error: unknown): QuoteError {
    if (error instanceof AxiosError) {
      return QuoteError.fromAxiosError(error);
    }
    return new QuoteError(error instanceof Error ? error.message : String(error));
  }

  static fromAxiosError(error: AxiosError<ZeroXAPIErrorData>): QuoteError {
    const formattedError = QuoteError.formatV2ApiError(error);
    return new QuoteError(formattedError);
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
}
