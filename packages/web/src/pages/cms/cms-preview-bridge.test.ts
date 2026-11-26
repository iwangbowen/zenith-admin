import { describe, expect, it } from 'vitest';
import { cmsPreviewDocument, readCmsPreviewPosition } from './cms-preview-bridge';
describe('CMS preview bridge', () => {
  it('keeps the sandbox policy and nonce binding', () => {
    const html = cmsPreviewDocument('<html><head></head><body><main>Preview</main></body></html>', 'test-nonce');
    expect(html).toContain("form-action 'none'"); expect(html).toContain("connect-src 'none'");
    expect(html).toContain('e.source!==parent'); expect(html).toContain('e.data.nonce!==nonce');
  });
  it('accepts bounded positions and rejects malformed frame messages', () => {
    const value = { x: 0, y: 1500, selectedKey: 'page:1:a', anchorOffset: -15 };
    expect(readCmsPreviewPosition(value)).toEqual(value);
    for (const invalid of [{ ...value, y: Infinity }, { ...value, selectedKey: 4 }, { ...value, anchorOffset: NaN }]) expect(readCmsPreviewPosition(invalid)).toBeNull();
  });
});
