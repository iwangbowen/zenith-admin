import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readCmsThemePreviewAsset: vi.fn(async () => ({
    content: Buffer.from('preview-asset'),
    contentType: 'text/css; charset=utf-8',
  })),
  readCmsThemeAsset: vi.fn(),
}));

vi.mock('../../services/cms/cms-themes.service', () => ({
  readCmsThemeAsset: mocks.readCmsThemeAsset,
  readCmsThemePreviewAsset: mocks.readCmsThemePreviewAsset,
}));

import { createCmsFrontPublicRoutes } from './front-public';

describe('CMS public preview asset route', () => {
  it('registers preview assets as an independently reachable route', async () => {
    const app = createCmsFrontPublicRoutes();
    const response = await app.request('/theme-preview-assets/2/9/9999999999/abc123/assets/css/site.css');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('preview-asset');
    expect(mocks.readCmsThemePreviewAsset).toHaveBeenCalledWith(2, 9, 9_999_999_999, 'abc123', 'css/site.css');
    expect(mocks.readCmsThemeAsset).not.toHaveBeenCalled();
  });
});
