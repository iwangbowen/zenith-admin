import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const connection = process.env.TEST_DATABASE_URL;
const suite = connection ? describe : describe.skip;
suite('configuration draft database guard', () => {
  let sql: ReturnType<typeof postgres>;
  const namespace = `release_guard_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a disposable local zenith_review database');
    sql = postgres(connection!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${namespace}"`);
    await sql.unsafe(`SET search_path TO "${namespace}", public`);
    await sql`CREATE TABLE cms_releases (id integer PRIMARY KEY, site_id integer NOT NULL, source text NOT NULL, status text NOT NULL, deployment_id integer, base_generation_id integer, items jsonb NOT NULL DEFAULT '[]', configuration_items jsonb NOT NULL DEFAULT '[]', configuration_snapshot jsonb NOT NULL DEFAULT '{}')`;
    await sql.unsafe(await readFile(new URL('../../../drizzle/0014_cms_release_draft_guard.sql', import.meta.url), 'utf8'));
    await sql`CREATE TRIGGER release_guard BEFORE UPDATE ON cms_releases FOR EACH ROW EXECUTE FUNCTION cms_release_configuration_immutable()`;
  });
  afterAll(async () => { if (sql) { await sql.unsafe(`DROP SCHEMA "${namespace}" CASCADE`); await sql.end(); } });
  it('allows consecutive draft saves but freezes a built configuration even after failure', async () => {
    await sql`INSERT INTO cms_releases(id,site_id,source,status) VALUES(1,1,'configuration','draft')`;
    await sql`UPDATE cms_releases SET configuration_snapshot='{"version":2}', base_generation_id=8 WHERE id=1`;
    await sql`UPDATE cms_releases SET status='building',deployment_id=9 WHERE id=1`;
    await expect(sql`UPDATE cms_releases SET configuration_snapshot='{"version":3}' WHERE id=1`).rejects.toMatchObject({ code: '23514' });
    await sql`UPDATE cms_releases SET status='failed' WHERE id=1`;
    await expect(sql`UPDATE cms_releases SET configuration_snapshot='{"version":4}' WHERE id=1`).rejects.toMatchObject({ code: '23514' });
  });
  it('preserves manual inputs and permits content-only baseline advancement without revision edits', async () => {
    await sql`INSERT INTO cms_releases(id,site_id,source,status) VALUES(2,1,'manual','draft'),(3,1,'content','draft')`;
    await expect(sql`UPDATE cms_releases SET configuration_snapshot='{"version":2}' WHERE id=2`).rejects.toMatchObject({ code: '23514' });
    await sql`UPDATE cms_releases SET base_generation_id=12 WHERE id=3`;
    await expect(sql`UPDATE cms_releases SET items='[{"revisionId":3}]' WHERE id=3`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE cms_releases SET source='configuration' WHERE id=2`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE cms_releases SET site_id=2 WHERE id=3`).rejects.toMatchObject({ code: '23514' });
  });
});
