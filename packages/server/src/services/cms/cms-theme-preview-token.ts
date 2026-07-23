import { createHmac, timingSafeEqual } from 'node:crypto';

const PREVIEW_ASSET_TTL_SECONDS = 5 * 60;

function signature(siteId: number, packageId: number, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`cms-theme-preview-asset:${siteId}:${packageId}:${expiresAt}`)
    .digest('hex');
}

export function createCmsThemePreviewAssetBaseUrl(
  siteId: number,
  packageId: number,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const expiresAt = nowSeconds + PREVIEW_ASSET_TTL_SECONDS;
  const token = signature(siteId, packageId, expiresAt, secret);
  return `/api/public/cms/theme-preview-assets/${siteId}/${packageId}/${expiresAt}/${token}/assets`;
}

export function verifyCmsThemePreviewAssetToken(
  siteId: number,
  packageId: number,
  expiresAt: number,
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !Number.isInteger(siteId) || siteId <= 0
    || !Number.isInteger(packageId) || packageId <= 0
    || !Number.isInteger(expiresAt) || expiresAt < nowSeconds
    || expiresAt > nowSeconds + PREVIEW_ASSET_TTL_SECONDS
    || !/^[a-f0-9]{64}$/.test(token)
  ) return false;
  const expected = Buffer.from(signature(siteId, packageId, expiresAt, secret), 'hex');
  const provided = Buffer.from(token, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
