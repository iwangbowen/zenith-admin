import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import { captureCmsConfiguration, cmsConfigurationSelection } from './cms-configuration-snapshot.service';

describe('CMS configuration publication snapshots', () => {
  it('retains the submitted page and its own placement set after a later edit', async () => {
    const page = { id: 8, site_id: 2, name: 'Submitted title', blocks: [] };
    const execute = vi.fn()
      .mockResolvedValueOnce([{ row: structuredClone(page) }])
      .mockResolvedValueOnce([]);
    const frozen = await captureCmsConfiguration({ execute } as unknown as DbTransaction, 2, { pageIds: [8] });
    page.name = 'Later working title';
    expect(frozen.snapshot.tables.cms_pages[0].name).toBe('Submitted title');
    expect(frozen.snapshot.tables.cms_widget_refs).toEqual([]);
    expect(frozen.snapshot.pageIds).toEqual([8]);
    expect(frozen.snapshot.tables.cms_widgets).toBeUndefined();
    expect(frozen.snapshot.replaceAll).toEqual([]);
  });
  it('captures deletion intent without reading a replacement page later', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const frozen = await captureCmsConfiguration({ execute } as unknown as DbTransaction, 2, { pageIds: [8], allowDeletedSelection: true });
    expect(frozen.snapshot.deleteIds?.cms_pages).toEqual([8]);
    expect(frozen.items).toContainEqual({ kind: 'page', id: 8, title: '删除 #8' });
  });
  it('does not include page or widget working configurations in implicit content releases', () => {
    expect(cmsConfigurationSelection({ targetType: 'content' })).toEqual({ pageIds: [], widgetIds: [], includeSiteConfiguration: false });
    expect(cmsConfigurationSelection({ targetType: 'page', pageId: 8 }).pageIds).toEqual([8]);
  });
});
