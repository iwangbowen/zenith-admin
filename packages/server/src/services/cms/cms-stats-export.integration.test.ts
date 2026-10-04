import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createPgClient } from '../../db/client';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import { withDbExecutor } from '../../db';
import { runWithCurrentUser } from '../../lib/context';
import { prepareCmsStatisticsExportQuery, withCmsStatisticsExportSnapshot } from './cms-stats-export-query';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 1, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });

describe.skipIf(!connection)('CMS statistics export PostgreSQL snapshot', () => {
  it('keeps count, ordering and every batch stable when facts change during consumption', async () => {
    const target = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review database');
    const testDb = drizzle(client!, { schema, casing: 'snake_case' });
    const rollback = new Error('rollback CMS statistics export fixtures');
    try {
      await testDb.transaction(async tx => withDbExecutor(tx, async () => {
        const suffix = randomUUID().slice(0, 8);
        const [user] = await tx.insert(schema.users).values({ username: `qa-export-${suffix}`, nickname: 'Export QA', password: 'unused', userDataScope: 'all' }).returning();
        const [site] = await tx.insert(schema.cmsSites).values({ code: `qa-export-${suffix}`, name: 'QA export snapshot', theme: 'default', settings: {} }).returning();
        await tx.insert(schema.userEvents).values(Array.from({ length: 1005 }, (_, index) => ({
          eventId: randomUUID(), eventType: 'page_view' as const, eventName: 'cms.page_view', appId: `cms-${site.id}`, deviceType: 'desktop' as const, pagePath: `/news/content-${index + 1}.html`,
          createdAt: new Date('2026-01-02T01:00:00Z'),
          properties: { cmsSchemaVersion: 2, cmsSiteId: site.id, environment: 'live', trustedCms: true, visitorId: `visitor-${index}`, sessionId: `session-${index}`, pageViewId: `view-${index}`, contentId: index + 1, contentTitle: `content-${index + 1}`, author: 'QA' },
        })));
        await runWithCurrentUser({ userId: user.id, username: user.username, roles: ['super_admin'], tenantId: null }, async () => {
          const query = await prepareCmsStatisticsExportQuery({ siteId: site.id, startTime: '2026-01-02', endTime: '2026-01-02', compare: 'none', dimension: 'content', sortBy: 'pv' });
          const keys: string[] = [];
          await withCmsStatisticsExportSnapshot(query, async (rows, total) => {
            expect(total).toBe(1005);
            for await (const row of rows) {
              keys.push(row.key);
              if (keys.length === 1) await tx.execute(sql`delete from user_events where properties->>'cmsSiteId'=${String(site.id)}`);
              expect(row.pv).toBe(1); expect(row.reportVersion).toBe('cms-events-v2.attribution-v1');
            }
          });
          expect(keys).toHaveLength(1005); expect(new Set(keys).size).toBe(1005);
          expect(keys).toEqual([...keys].sort());
          expect(await tx.$count(schema.userEvents, sql`properties->>'cmsSiteId'=${String(site.id)}`)).toBe(0);
        });
        throw rollback;
      }));
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
