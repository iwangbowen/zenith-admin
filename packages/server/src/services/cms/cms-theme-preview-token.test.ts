import { describe, expect, it } from 'vitest';
import {
  createCmsThemePreviewAssetBaseUrl,
  verifyCmsThemePreviewAssetToken,
} from './cms-theme-preview-token';

describe('CMS theme preview asset capability', () => {
  it('binds a short-lived token to the exact site and package', () => {
    const base = createCmsThemePreviewAssetBaseUrl(2, 9, 'test-secret', 1_000);
    const [, siteId, packageId, expiresAt, token] = base.match(/theme-preview-assets\/(\d+)\/(\d+)\/(\d+)\/([a-f0-9]+)\/assets$/)!;
    expect(verifyCmsThemePreviewAssetToken(Number(siteId), Number(packageId), Number(expiresAt), token, 'test-secret', 1_100)).toBe(true);
    expect(verifyCmsThemePreviewAssetToken(3, Number(packageId), Number(expiresAt), token, 'test-secret', 1_100)).toBe(false);
    expect(verifyCmsThemePreviewAssetToken(Number(siteId), 10, Number(expiresAt), token, 'test-secret', 1_100)).toBe(false);
    expect(verifyCmsThemePreviewAssetToken(Number(siteId), Number(packageId), Number(expiresAt), token, 'test-secret', 1_301)).toBe(false);
  });
});
