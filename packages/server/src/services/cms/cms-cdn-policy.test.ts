import { describe, expect, it } from 'vitest';
import { CMS_CDN_HTTP_SAFETY_OPTIONS, validateCdnPurgeEndpoint } from './cms-cdn-policy';

describe('CMS CDN purge endpoint policy', () => {
  it('forces SSRF protection and disables redirects in http-client calls', () => {
    expect(CMS_CDN_HTTP_SAFETY_OPTIONS).toEqual({
      ssrfProtection: true,
      redirect: 'error',
    });
  });

  it('requires an explicit exact or wildcard public-domain allowlist', () => {
    expect(validateCdnPurgeEndpoint('https://purge.example.com/v1', ['purge.example.com']).hostname)
      .toBe('purge.example.com');
    expect(validateCdnPurgeEndpoint('https://edge.cdn.example.com/purge', ['*.cdn.example.com']).hostname)
      .toBe('edge.cdn.example.com');
    expect(() => validateCdnPurgeEndpoint('https://example.com/purge', [])).toThrow();
    expect(() => validateCdnPurgeEndpoint('https://evil.example/purge', ['purge.example.com'])).toThrow();
  });

  it.each([
    'http://localhost/purge',
    'http://127.0.0.1/purge',
    'http://10.0.0.1/purge',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/purge',
    'https://metadata.google.internal/computeMetadata/v1',
    'https://instance-data.ec2.internal/latest/meta-data',
  ])('rejects local, private or metadata literal %s even if listed', (url) => {
    const host = new URL(url).hostname;
    expect(() => validateCdnPurgeEndpoint(url, [host])).toThrow();
  });

  it('rejects credentials and non-http protocols', () => {
    expect(() => validateCdnPurgeEndpoint('https://user:pass@purge.example.com', ['purge.example.com'])).toThrow();
    expect(() => validateCdnPurgeEndpoint('https://purge.example.com?token=secret', ['purge.example.com'])).toThrow();
    expect(() => validateCdnPurgeEndpoint('file:///etc/passwd', ['purge.example.com'])).toThrow();
  });
});
