import { describe, expect, it } from 'vitest';
import { mergeCmsConfigurationSnapshots } from './release-configuration';
describe('configuration publication draft merging', () => {
  it('keeps independent changes while the latest version of an edited object wins', () => {
    const previous = { tables: { cms_pages: [{ id: 1, name: 'old' }, { id: 2, name: 'keep' }] }, replaceAll: [], pageIds: [1, 2] };
    const next = mergeCmsConfigurationSnapshots(previous, { tables: { cms_pages: [{ id: 1, name: 'new' }] }, replaceAll: [], pageIds: [1] });
    expect(next.tables.cms_pages).toEqual([{ id: 1, name: 'new' }, { id: 2, name: 'keep' }]);
    expect(previous.tables.cms_pages[0].name).toBe('old');
  });
  it('replaces a selected page placement collection including removing its last widget', () => {
    const previous = { tables: { cms_widget_refs: [{ id: 5, owner_type: 'page', owner_id: 1 }, { id: 6, owner_type: 'page', owner_id: 2 }] }, replaceAll: [] };
    const result = mergeCmsConfigurationSnapshots(previous, { tables: { cms_widget_refs: [] }, replaceAll: [], pageIds: [1] });
    expect(result.tables.cms_widget_refs).toEqual([{ id: 6, owner_type: 'page', owner_id: 2 }]);
  });
  it('keeps complete-snapshot semantics when a later capture edits only one object', () => {
    const previous = { tables: { cms_pages: [{ id: 1 }, { id: 2 }] }, replaceAll: ['cms_pages'] };
    const removed = mergeCmsConfigurationSnapshots(previous, { tables: { cms_pages: [] }, replaceAll: [], deleteIds: { cms_pages: [1] } });
    expect(removed.tables.cms_pages).toEqual([{ id: 2 }]);
    expect(removed.replaceAll).toEqual(['cms_pages']);
    const restored = mergeCmsConfigurationSnapshots(removed, { tables: { cms_pages: [{ id: 1, name: 'restored' }] }, replaceAll: [] });
    expect(restored.deleteIds?.cms_pages).toEqual([]);
    expect(restored.tables.cms_pages).toContainEqual({ id: 1, name: 'restored' });
  });
  it('uses a later whole-site snapshot as authoritative, not a union with removed pages', () => {
    expect(mergeCmsConfigurationSnapshots({ tables: { cms_pages: [{ id: 1 }] }, replaceAll: [], deleteIds: { cms_pages: [2] } },
      { tables: { cms_pages: [{ id: 3 }] }, replaceAll: ['cms_pages'] })).toMatchObject({ tables: { cms_pages: [{ id: 3 }] }, deleteIds: { cms_pages: [] } });
  });
});
