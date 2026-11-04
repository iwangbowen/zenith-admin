import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../../../middleware/auth';
import type { ExportRuntimeContext } from '../../../lib/export-center/types';
import { formatExportValue } from '../../../lib/export-center/formatter';

const mocks = vi.hoisted(() => ({ count: vi.fn(), where: vi.fn(), rows: vi.fn() }));
vi.mock('../../../db/index', () => ({ db: { $count: mocks.count } }));
vi.mock('../cms-contents-query.service', () => ({
  buildCmsContentListWhere: mocks.where,
  loadCmsContentListRows: mocks.rows,
}));

import { cmsContentsExportDefinition } from './cms-contents';

const user: JwtPayload = { userId: 7, username: 'editor', roles: [], tenantId: null };
const context = {} as ExportRuntimeContext;

describe('CMS export contract filters and editorial projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.where.mockResolvedValue(undefined);
    mocks.count.mockResolvedValue(0);
    mocks.rows.mockResolvedValue([]);
  });

  it('preserves the entire list filter when preparing, counting and reading a JSON export request', async () => {
    const filter = {
      siteId: 16, channelId: 65, modelId: 12, ownerId: 7, locale: 'en-US', tags: '3,5',
      status: 'published', editorialStatus: 'approved', contentType: 'article', keyword: '工作稿',
      hasUnpublishedChanges: true, isTop: false, isRecommend: true, isHot: false, isOriginal: true,
      overdue: false, scheduled: true, hasUnresolvedNotes: false, deleted: false, archived: false,
      startTime: '2026-09-01', endTime: '2026-09-30', calendarFrom: '2026-10-01', calendarTo: '2026-10-31',
    };
    const query = { ...filter, page: 7, pageSize: 20 };
    expect(await cmsContentsExportDefinition.prepareQuery!(query, user)).toEqual(filter);
    await cmsContentsExportDefinition.countRows(query, user);
    await cmsContentsExportDefinition.streamRows(query, user, context);
    expect(mocks.where).toHaveBeenCalledWith(filter);
    expect(mocks.rows).toHaveBeenCalledWith(filter, { limit: 50_001 });
  });

  it('accepts URL-style booleans and drops empty controls without changing false into true', async () => {
    const prepared = await cmsContentsExportDefinition.prepareQuery!({
      siteId: '16', ownerId: '', locale: null, status: '', tags: '',
      hasUnpublishedChanges: 'false', scheduled: '0', isTop: false, hasUnresolvedNotes: 'yes',
    }, user);
    expect(prepared).toEqual({ siteId: 16, hasUnpublishedChanges: false, scheduled: false, isTop: false, hasUnresolvedNotes: true });
  });

  it.each([
    { siteId: 0 },
    { siteId: 16, modelId: 'invalid' },
    { siteId: 16, tags: '3,invalid' },
    { siteId: 16, editorialStatus: 'not-a-state' },
    { siteId: 16, hasUnpublishedChanges: 'maybe' },
    { siteId: 16, calendarFrom: 'yesterday' },
  ])('rejects invalid filters instead of broadening the export: %j', async (query) => {
    await expect(cmsContentsExportDefinition.countRows(query, user)).rejects.toThrow();
    expect(mocks.where).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it('exports working title, channel, author and flags with the list ordering and nullable dates', async () => {
    mocks.rows.mockResolvedValue([
      { id: 138, title: '工作稿 B', channelName: '工作稿栏目', author: '新作者', source: '新来源',
        status: 'published', isTop: true, isRecommend: true, isHot: false, viewCount: 17,
        publishedAt: null, createdAt: '2026-09-30 08:03:11' },
      { id: 139, title: '英文工作稿', channelName: '资讯', author: null, source: null,
        status: 'draft', isTop: false, isRecommend: false, isHot: false, viewCount: 0,
        publishedAt: null, createdAt: '2026-09-30 08:04:11' },
    ]);
    const rows = await cmsContentsExportDefinition.streamRows({ siteId: 16 }, user, context);
    expect(rows).toEqual([
      { id: 138, title: '工作稿 B', channelName: '工作稿栏目', author: '新作者', source: '新来源',
        statusText: '已发布', flags: '置顶/推荐', viewCount: 17, publishedAt: null, createdAt: '2026-09-30 08:03:11' },
      { id: 139, title: '英文工作稿', channelName: '资讯', author: '', source: '',
        statusText: '草稿', flags: '', viewCount: 0, publishedAt: null, createdAt: '2026-09-30 08:04:11' },
    ]);
    const at = cmsContentsExportDefinition.columns.find((column) => column.key === 'publishedAt')!;
    for await (const row of rows) expect(formatExportValue(at, row)).toBe('');
  });

  it('counts beyond the export ceiling without loading or silently truncating rows', async () => {
    mocks.count.mockResolvedValue(50_001);
    await expect(cmsContentsExportDefinition.countRows({ siteId: 16 }, user)).resolves.toBe(50_001);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
