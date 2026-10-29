import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createOpenApiDocCache, getCachedOpenApiDoc, setCachedOpenApiDoc } from './openapi-doc-cache';

describe('OpenAPI cache ownership', () => {
  it('keeps independent route sets and compressed bytes without resetting another app', () => {
    const identity = createOpenApiDocCache();
    const payment = createOpenApiDocCache();
    identity.set('{"identity":true}');
    payment.set('{"payment":true}');
    expect(identity.get()?.json).toBe('{"identity":true}');
    expect(gunzipSync(payment.get()!.gzip).toString()).toBe('{"payment":true}');
    expect(getCachedOpenApiDoc()).toBeNull();
  });
  it('preserves the production warmup cache and precompressed data', () => {
    const bytes = new Uint8Array([1, 2]);
    setCachedOpenApiDoc('production', bytes);
    expect(getCachedOpenApiDoc()).toEqual({ json: 'production', gzip: bytes });
    const domain = createOpenApiDocCache();
    expect(domain.get()).toBeNull();
  });
});
