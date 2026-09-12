/**
 * CMS 内容 / 发布产物导出与列表共用 where 的回归测试。
 *
 * 此前导出定义自行拼装 13 条内容筛选条件，且栏目可见性用「未授权任何栏目时不加限制」的宽松实现，
 * 与列表的 getAccessibleChannelIds()（空集 → 不返回任何行）不一致：同一用户在列表里看不到内容却能导出全站。
 * 这里锁定：导出定义只经 service 的 buildCmsContentListWhere / buildCmsPublishArtifactsWhere 取 where，
 * 且非管理员无授权栏目时 where 里出现 `false`（inArray 空集）。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../../db', () => ({
  db: { select: vi.fn(), $count: vi.fn(), query: {}, transaction: vi.fn(), execute: vi.fn() },
  readSnapshot: vi.fn(),
}));
vi.mock('../../../lib/redis', () => ({ default: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn(), incrby: vi.fn(), hgetall: vi.fn() } }));
vi.mock('../../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../lib/context', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/context')>(),
  currentUser: vi.fn(() => ({ userId: 7, username: 'editor', roles: [], tenantId: null })),
  currentUserOrNull: vi.fn(() => ({ userId: 7, username: 'editor', roles: [], tenantId: null })),
}));
vi.mock('../../../lib/data-scope', () => ({ getDataScopeCondition: vi.fn(async () => undefined) }));
vi.mock('../../../services/cms/cms-sites.service', () => ({
  assertSiteAccess: vi.fn(async () => undefined),
  ensureCmsSiteExists: vi.fn(async () => ({ id: 1, code: 'demo' })),
}));
vi.mock('../../../services/cms/cms-channels.service', () => ({
  getAccessibleChannelIds: vi.fn(async () => [] as number[]),
  assertChannelAccess: vi.fn(async () => undefined),
}));

import { getAccessibleChannelIds } from '../../../services/cms/cms-channels.service';
import { buildCmsContentListWhere } from '../../../services/cms/cms-contents-query.service';

const dialect = new PgDialect();

describe('CMS 内容导出与列表共用 where', () => {
  it('导出定义不再自行拼装条件，只经 service 构造器取 where', async () => {
    const contents = await readFile(new URL('./cms-contents.ts', import.meta.url), 'utf8');
    expect(contents).toContain('buildCmsContentListWhere(');
    expect(contents).not.toMatch(/allowedChannelCondition|cmsChannelUsers|buildWhere\(/);
    const artifacts = await readFile(new URL('./cms-publish-artifacts.ts', import.meta.url), 'utf8');
    expect(artifacts).toContain('buildCmsPublishArtifactsWhere(');
    expect(artifacts).not.toMatch(/buildWhere\(|keywordCondition\(/);
  });

  it('非管理员无授权栏目时 where 为空集（与列表一致），而不是导出全站', async () => {
    vi.mocked(getAccessibleChannelIds).mockResolvedValueOnce([]);
    const where = await buildCmsContentListWhere({ siteId: 1 });
    const { sql: text, params } = dialect.sqlToQuery(where!);
    expect(text).toMatch(/false/);
    expect(params).toEqual([1]);
  });

  it('有授权栏目时限定 channelId 集合；平台管理员（null）不加栏目限制', async () => {
    vi.mocked(getAccessibleChannelIds).mockResolvedValueOnce([3, 5]);
    const scoped = dialect.sqlToQuery((await buildCmsContentListWhere({ siteId: 1, keyword: '通知' }))!);
    expect(scoped.sql).toMatch(/"channelId" in \(\$2, \$3\)/);
    // 关键字同时匹配标题与作者两列
    expect(scoped.params).toEqual([1, 3, 5, '%通知%', '%通知%']);

    vi.mocked(getAccessibleChannelIds).mockResolvedValueOnce(null);
    const admin = dialect.sqlToQuery((await buildCmsContentListWhere({ siteId: 1 }))!);
    expect(admin.sql).not.toMatch(/"channelId" in/);
  });
});
