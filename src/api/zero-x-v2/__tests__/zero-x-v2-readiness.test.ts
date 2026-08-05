import chai from 'chai';
import { ZeroXConfig } from '../../../models/zero-x-config';
import {
  assertZeroXV2Configured,
  getZeroXV2Readiness,
} from '../zero-x-v2-readiness';
import {
  createZeroXV2UrlAndHeaders,
  ZeroXV2ApiEndpoint,
} from '../zero-x-v2-fetch';

const { expect } = chai;

describe('zero-x-v2 readiness', () => {
  let savedKey: Optional<string>;
  let savedProxy: Optional<string>;

  before(() => {
    savedKey = ZeroXConfig.API_KEY;
    savedProxy = ZeroXConfig.PROXY_API_DOMAIN;
  });

  afterEach(() => {
    ZeroXConfig.API_KEY = savedKey;
    ZeroXConfig.PROXY_API_DOMAIN = savedProxy;
  });

  it('Should report unconfigured when neither setting is present', () => {
    ZeroXConfig.API_KEY = undefined;
    ZeroXConfig.PROXY_API_DOMAIN = undefined;

    const readiness = getZeroXV2Readiness();
    expect(readiness.configured).to.equal(false);
    expect(readiness.mode).to.equal('unconfigured');
    // The detail has to say what to do, because the alternative is discovering
    // this at the first quote inside a combo build.
    expect(readiness.detail).to.match(/PROXY_API_DOMAIN/);
    expect(readiness.detail).to.match(/API_KEY/);
  });

  it('Should report the proxy route when a domain is set', () => {
    ZeroXConfig.PROXY_API_DOMAIN = 'proxy.example.com';
    ZeroXConfig.API_KEY = undefined;

    const readiness = getZeroXV2Readiness();
    expect(readiness.configured).to.equal(true);
    expect(readiness.mode).to.equal('proxy');
  });

  it('Should report the direct route when only a key is set', () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = 'test-key-value'; // pragma: allowlist secret

    const readiness = getZeroXV2Readiness();
    expect(readiness.configured).to.equal(true);
    expect(readiness.mode).to.equal('direct-api-key');
  });

  it('Should match the precedence the fetch path actually uses', () => {
    // A readiness check that disagreed with the fetch path would reassure a
    // caller whose requests then fail. Proxy wins; the key is not consulted.
    ZeroXConfig.PROXY_API_DOMAIN = 'proxy.example.com';
    ZeroXConfig.API_KEY = 'test-key-value'; // pragma: allowlist secret

    expect(getZeroXV2Readiness().mode).to.equal('proxy');

    const { headers, url } = createZeroXV2UrlAndHeaders(
      ZeroXV2ApiEndpoint.GetSwapQuote,
      false,
    );
    expect(url).to.contain('proxy.example.com');
    expect(headers).to.deep.equal({});
  });

  it('Should never echo the API key', () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = 'super-secret-key-value'; // pragma: allowlist secret

    const readiness = getZeroXV2Readiness();
    // The detail is explicitly documented as safe to log.
    expect(readiness.detail).to.not.contain('super-secret-key-value');
  });

  it('Should agree with what the fetch path does when unconfigured', () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = undefined;

    expect(getZeroXV2Readiness().configured).to.equal(false);
    // The point of the readiness check is that this throw happens LATER, deep
    // inside a combo build. Asserting both here keeps the two in step.
    expect(() =>
      createZeroXV2UrlAndHeaders(ZeroXV2ApiEndpoint.GetSwapQuote, false),
    ).to.throw(/API Key/);
  });

  it('Should raise from the asserting form only when unconfigured', () => {
    ZeroXConfig.PROXY_API_DOMAIN = undefined;
    ZeroXConfig.API_KEY = undefined;
    expect(() => assertZeroXV2Configured()).to.throw(/not configured/);

    ZeroXConfig.PROXY_API_DOMAIN = 'proxy.example.com';
    expect(assertZeroXV2Configured().mode).to.equal('proxy');
  });
});
