/**
 * CMS 内容 / 发布产物导出与列表共用 where 的回归测试。
 *
 * 导出必须复用 service 的 buildCmsContentListWhere / buildCmsPublishArtifactsWhere；
 * 非管理员无授权栏目时条件为 false（inArray 空集），不能以无限制查询代替。
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('../../../db/index', () => ({
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
vi.mock('../cms-sites.service', () => ({
  assertSiteAccess: vi.fn(async () => undefined),
  ensureCmsSiteExists: vi.fn(async () => ({ id: 1, code: 'demo' })),
}));
vi.mock('../cms-channels.service', () => ({
  getAccessibleChannelIds: vi.fn(async () => [] as number[]),
  assertChannelAccess: vi.fn(async () => undefined),
}));

import { getAccessibleChannelIds } from '../cms-channels.service';
import { buildCmsContentListWhere } from '../cms-contents-query.service';

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
    // 公开栏目和工作稿栏目分别检查同一授权集合；关键字匹配工作稿标题与作者
    expect(scoped.params).toEqual([1, 3, 5, 3, 5, '%通知%', '%通知%']);
    expect(scoped.sql).toMatch(/snapshot.*channelId.*in \(\$4, \$5\)/);
    expect(scoped.sql).toContain('exists (select 1 from');

    vi.mocked(getAccessibleChannelIds).mockResolvedValueOnce(null);
    const admin = dialect.sqlToQuery((await buildCmsContentListWhere({ siteId: 1 }))!);
    expect(admin.sql).not.toMatch(/"channelId" in/);
  });
});
