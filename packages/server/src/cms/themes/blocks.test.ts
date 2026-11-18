import { describe, expect, it } from 'vitest';
import { renderBlocksHtml } from './blocks';
import type { CmsPageBlock } from '@zenith/shared/cms';

const render = (blocks: CmsPageBlock[]) => renderBlocksHtml({ blocks, contentListData: new Map(), widgetData: new Map(), themeCode: 'default' });
describe('responsive page images and trusted block wrappers', () => {
  it('escapes generated block identities and removes forged identity markers from rich text', () => {
    const html = render([{ id: 'block" data-fake="x', type: 'richtext', props: { html: '<p data-cms-page-block="true" data-cms-block-id="other" onclick="alert(1)">正文</p>' } }]);
    expect(html).toContain('data-cms-block-id="block&quot; data-fake=&quot;x"');
    expect(html.match(/data-cms-page-block="true"/gu)).toHaveLength(1); expect(html).not.toContain('data-cms-block-id="other"'); expect(html).not.toContain('onclick');
  });
});
