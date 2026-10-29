import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';

const state = vi.hoisted(() => ({ statements: [] as Array<{ sql: string; params: unknown[] }> }));
const now = new Date('2026-10-29T00:00:00Z');
const row = {
  id: 1, spaceId: 2, parentId: null, title: '文档', summary: '摘要', content: '正文中有 **性能关键字**',
  status: 'published', rejectReason: null, sort: 0, isPinned: false, viewCount: 1, currentVersion: 1, revision: 1,
  requireReadReceipt: false, ownerId: 9, expireAt: null, reviewCycleDays: null, nextReviewAt: null,
  isArchived: false, publishedAt: now, deletedAt: null, tenantId: 7, createdBy: 9, updatedBy: 9, createdAt: now, updatedAt: now,
};

vi.mock('../../db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const tx = drizzle.mock({ casing: 'snake_case' });
  const select = tx.select.bind(tx);
  vi.spyOn(tx, '$count').mockImplementation(() => Promise.resolve(1) as unknown as ReturnType<typeof tx.$count>);
  vi.spyOn(tx, 'select').mockImplementation((...args: unknown[]) => {
    const builder = Reflect.apply(select, tx, args);
    const from = builder.from;
    builder.from = (...fromArgs: unknown[]) => {
      const query = Reflect.apply(from, builder, fromArgs) as { execute: () => Promise<unknown[]>; toSQL: () => { sql: string; params: unknown[] } };
      query.execute = async () => {
        state.statements.push(query.toSQL());
        const table = getTableName(fromArgs[0] as Parameters<typeof getTableName>[0]);
        if (table === 'wiki_docs') return [row];
        if (table === 'wiki_doc_views') return [{ docId: 1, lastViewedAt: now.toISOString() }];
        if (table === 'wiki_spaces') return [{ id: 2, name: '知识空间' }];
        if (table === 'wiki_doc_tags') return [{ docId: 1, id: 3, name: '标签', color: null }];
        return [];
      };
      return query;
    };
    return builder;
  });
  return { db: tx };
});

import { runWithCurrentUser } from '../../lib/context';
import { listMyFavoriteWikiDocs, listRecentWikiDocs, listWikiDocs, searchWikiDocs } from './docs.service';

const user = { userId: 9, username: 'reader', roles: [], tenantId: 7 };
const q = { page: 1, pageSize: 20 };
const docStatement = () => state.statements.find((s) => s.sql.includes('from "wiki_docs"'))!;
const projection = () => docStatement().sql.split(' from ')[0];

beforeEach(() => { state.statements.length = 0; });

describe('wiki metadata query paths', () => {
  it.each(['list', 'favorites', 'recent'] as const)('%s keeps metadata and associations without selecting the body', async (path) => {
    const docs = await runWithCurrentUser(user, async () => path === 'recent' ? listRecentWikiDocs() : (await (path === 'list' ? listWikiDocs(q) : listMyFavoriteWikiDocs(q))).list);
    expect(projection()).not.toMatch(/\bcontent\b/);
    expect(docStatement().sql).toContain('"wiki_space_members"');
    expect(docStatement().sql).toContain('"wiki_docs"."status"');
    expect(docs[0]).toMatchObject({ id: 1, title: '文档', summary: '摘要', spaceName: '知识空间', tags: [{ name: '标签' }] });
    expect(docs[0]).not.toHaveProperty('content');
  });

  it('global-search mode retains body matching and ranking without transferring body text', async () => {
    const page = await runWithCurrentUser(user, () => searchWikiDocs({ ...q, keyword: '性能' }, { includeSnippet: false, recordSearchLog: false }));
    expect(projection()).not.toMatch(/\bcontent\b/);
    expect(docStatement().sql).toContain('"wiki_docs"."content"');
    expect(docStatement().params).toContain('%性能%');
    expect(page.list[0].snippet).toBeUndefined();
    expect(page.list[0]).not.toHaveProperty('content');
  });

  it('full search loads body text only to build the requested snippet', async () => {
    const page = await runWithCurrentUser(user, () => searchWikiDocs({ ...q, keyword: '性能' }, { recordSearchLog: false }));
    expect(projection()).toMatch(/\bcontent\b/);
    expect(page.list[0].snippet).toContain('性能关键字');
    expect(page.list[0]).not.toHaveProperty('content');
  });
});
