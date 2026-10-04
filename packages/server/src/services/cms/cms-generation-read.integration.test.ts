import { randomUUID } from 'node:crypto';
import { createPgClient } from '../../db/client';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { CmsGenerationReadUnavailable, pinCmsGenerationRead, readCmsGenerationSnapshot } from './cms-generation-read';

const connection = process.env.TEST_DATABASE_URL;
const client = connection ? createPgClient(connection, { max: 3, onnotice: () => undefined }) : null;
afterAll(async () => { await client?.end(); });
describe.skipIf(!connection)('CMS retained generation read lifetime', () => {
  it('prevents reclamation during reads and retries a stale pointer without falling back to working tables', async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires disposable local zenith_review');
    const review = drizzle(client!, { schema, casing: 'snake_case' });
    const ids: number[] = [], releases: number[] = []; let siteId: number | undefined;
    const drop = (id: number) => review.execute(sql`drop schema if exists ${sql.identifier(`cms_generation_${id}`)} cascade`);
    try {
      const [site] = await review.insert(schema.cmsSites).values({ name: 'QA read lifetime', code: `qa-read-${randomUUID().slice(0, 8)}` }).returning(); siteId = site.id;
      for (const marker of ['old', 'new']) {
        const [release] = await review.insert(schema.cmsReleases).values({ siteId, name: marker }).returning(); releases.push(release.id);
        const [deployment] = await review.insert(schema.cmsDeployments).values({ siteId, releaseId: release.id, status: 'retired' }).returning(); ids.push(deployment.id);
        await review.insert(schema.cmsDeploymentStorage).values({ deploymentId: deployment.id });
        const name = sql.identifier(`cms_generation_${deployment.id}`);
        await review.execute(sql`create schema ${name}`); await review.execute(sql`create table ${name}.cms_site_projection(marker text)`);
        await review.execute(sql`insert into ${name}.cms_site_projection values (${marker})`);
      }
      await review.insert(schema.cmsSiteGenerations).values({ siteId, activeGenerationId: ids[0] });
      // An active reader holds the same generation lock exclusively required by DROP.
      await review.transaction(async tx => {
        await pinCmsGenerationRead(tx, ids[0]);
        const [other] = await review.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('cms-generation-build'),${ids[0]}) as acquired`);
        expect(other.acquired).toBe(false);
      }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
      const [released] = await review.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('cms-generation-build'),${ids[0]}) as acquired`);
      expect(released.acquired).toBe(true);

      let switched = false; const dialect = new PgDialect();
      const executor = new Proxy(review, { get(target, property, receiver) {
        if (property === 'transaction') return (run: (tx: DbTransaction) => Promise<unknown>, ...options: unknown[]) => Reflect.apply(target.transaction, target, [async (tx: DbTransaction) => run(new Proxy(tx, { get(inner, key, innerReceiver) {
          const value = Reflect.get(inner, key, innerReceiver);
          if (key === 'execute') return async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
            if (!switched && dialect.sqlToQuery(statement).sql.includes('pg_advisory_xact_lock_shared')) {
              switched = true;
              await review.update(schema.cmsSiteGenerations).set({ activeGenerationId: ids[1] }).where(eq(schema.cmsSiteGenerations.siteId, siteId!));
              await review.update(schema.cmsDeploymentStorage).set({ storageState: 'purging' }).where(eq(schema.cmsDeploymentStorage.deploymentId, ids[0]));
              await drop(ids[0]);
            }
            return inner.execute(statement);
          };
          return typeof value === 'function' ? value.bind(inner) : value;
        } })), ...options]);
        const value = Reflect.get(target, property, receiver); return typeof value === 'function' ? value.bind(target) : value;
      } });
      const result = await readCmsGenerationSnapshot(siteId, async (tx, id) => {
        const [row] = await tx.execute<{ marker: string }>(sql`select marker from ${sql.identifier(`cms_generation_${id}`)}.cms_site_projection`);
        return row.marker;
      }, executor);
      expect(switched).toBe(true); expect(result).toBe('new');
      await expect(review.transaction(tx => pinCmsGenerationRead(tx, ids[0]))).rejects.toBeInstanceOf(CmsGenerationReadUnavailable);
    } finally {
      if (siteId) await review.delete(schema.cmsSiteGenerations).where(eq(schema.cmsSiteGenerations.siteId, siteId));
      for (const id of ids) await drop(id);
      if (ids.length) await review.delete(schema.cmsDeployments).where(inArray(schema.cmsDeployments.id, ids));
      if (releases.length) await review.delete(schema.cmsReleases).where(inArray(schema.cmsReleases.id, releases));
      if (siteId) await review.delete(schema.cmsSites).where(eq(schema.cmsSites.id, siteId));
    }
  }, 60_000);
});
