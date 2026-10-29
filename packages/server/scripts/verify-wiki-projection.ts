/** Real PostgreSQL regression. Fixtures exist only in a transaction-local temporary table. */
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, closeDb, withDbExecutor } from '../src/db';
import { wikiDocs } from '../src/db/schema';
import { runWithCurrentUser } from '../src/lib/context';
import { wikiDocListColumns } from '../src/services/wiki/wiki-doc-columns';
import { listWikiDocs, searchWikiDocs } from '../src/services/wiki/docs.service';
import redis from '../src/lib/redis';

try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`create temporary table wiki_docs (like public.wiki_docs including defaults) on commit drop`);
    await tx.execute(sql`insert into wiki_docs (id, space_id, title, summary, content, status)
      select n, 2147483647, '性能文档 ' || n, '摘要', repeat(md5(n::text), 6400) || '性能关键字', 'published'
      from generate_series(1, 20) as n`);
    const full = await tx.select().from(wikiDocs);
    const light = await tx.select(wikiDocListColumns).from(wikiDocs);
    assert.equal(full.length, light.length);
    assert(!('content' in light[0]));
    const stripBody = full.map(({ content: _content, ...row }) => row);
    assert.deepEqual(light, stripBody);
    await withDbExecutor(tx, () => runWithCurrentUser({ userId: 1, username: 'projection-regression', roles: ['super_admin'], tenantId: null }, async () => {
      const list = await listWikiDocs({ page: 1, pageSize: 20 });
      assert.equal(list.total, 20);
      assert.equal(list.list.length, 20);
      const search = await searchWikiDocs({ page: 1, pageSize: 20, keyword: '性能关键字' }, { recordSearchLog: false, includeSnippet: false });
      assert.equal(search.total, 20);
      assert(search.list.every((row) => !row.snippet && !('content' in row)));
      const snippets = await searchWikiDocs({ page: 1, pageSize: 20, keyword: '性能关键字' }, { recordSearchLog: false });
      assert(snippets.list.every((row) => row.snippet?.includes('性能关键字')));
    }));
    process.stdout.write(JSON.stringify({ fullRowsBytes: Buffer.byteLength(JSON.stringify(full)), projectedRowsBytes: Buffer.byteLength(JSON.stringify(light)), rows: light.length, serviceListAndSearch: 'PASS' }) + '\n');
  });
} finally {
  await closeDb();
  redis.disconnect();
}
