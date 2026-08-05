import { isDefined } from '@railgun-community/shared-models';
import { ZeroXConfig } from '../../models/zero-x-config';

export type ZeroXV2Mode =
  /** A proxy domain is set; requests carry no API key. */
  | 'proxy'
  /** No proxy, but an API key is set; requests go direct to 0x with headers. */
  | 'direct-api-key'
  /** Neither is set. Every quote will throw `MissingHeadersError`. */
  | 'unconfigured';

export type ZeroXV2Readiness = {
  /** False only for `unconfigured`. */
  readonly configured: boolean;
  readonly mode: ZeroXV2Mode;
  /** One line, safe to log or surface. Never contains the API key. */
  readonly detail: string;
};

/**
 * Report whether 0x V2 is configured, and by which route, WITHOUT making a
 * request.
 *
 * **Why this exists.** `ZeroXConfig.PROXY_API_DOMAIN` and
 * `ZeroXConfig.API_KEY` are static mutables read at fetch time, so whether a
 * swap works depends on global initialisation order — and the failure surfaces
 * at the first quote, which is deep inside a combo build, long after the
 * mistake was made. A consumer had no way to ask "am I set up?" short of
 * attempting a swap.
 *
 * Call this at startup, after configuring, and fail there instead.
 *
 * **The brief's characterisation of this hazard is out of date and worth
 * correcting.** §4.8 says an unset proxy domain makes a combo "look like a hang
 * rather than an error". It does not: `createV2Headers` throws
 * `MissingHeadersError` synchronously, and that error already names the cause
 * and the fix ("No 0x API Key is configured. Set ZeroXConfig.API_KEY"). What is
 * genuinely wrong is the TIMING, not the message — you learn at first quote
 * rather than at configuration.
 *
 * Note the precedence deliberately mirrors `createZeroXV2UrlAndHeaders`: a
 * proxy domain wins, and an API key is not consulted when one is set. Reporting
 * a different precedence here than the fetch path uses would make this reassure
 * a caller whose requests then fail.
 */
export const getZeroXV2Readiness = (): ZeroXV2Readiness => {
  const proxyDomain = ZeroXConfig.PROXY_API_DOMAIN;
  if (isDefined(proxyDomain) && proxyDomain.length > 0) {
    return {
      configured: true,
      mode: 'proxy',
      // The domain is not a secret — it is the host requests are sent to — but
      // the key is, so it is never echoed by any branch here.
      detail: `0x V2 requests route through the proxy at ${proxyDomain}; no API key is used.`,
    };
  }

  const apiKey = ZeroXConfig.API_KEY;
  if (isDefined(apiKey) && apiKey.length > 0) {
    return {
      configured: true,
      mode: 'direct-api-key',
      detail:
        '0x V2 requests go direct to the 0x API with a configured key. Set ' +
        'ZeroXConfig.PROXY_API_DOMAIN instead to route through a proxy.',
    };
  }

  return {
    configured: false,
    mode: 'unconfigured',
    detail:
      'Neither ZeroXConfig.PROXY_API_DOMAIN nor ZeroXConfig.API_KEY is set, so ' +
      'every 0x V2 quote will throw MissingHeadersError. Any recipe or combo ' +
      'with a swap leg will fail at build time — set one of the two before ' +
      'building. For tests, modify test-config-overrides.test.ts.',
  };
};

/**
 * {@link getZeroXV2Readiness}, raising when unconfigured. For an application
 * that wants to fail at startup rather than at the first swap.
 */
export const assertZeroXV2Configured = (): ZeroXV2Readiness => {
  const readiness = getZeroXV2Readiness();
  if (!readiness.configured) {
    throw new Error(`0x V2 is not configured: ${readiness.detail}`);
  }
  return readiness;
};
