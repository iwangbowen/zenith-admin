import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { db, withDbExecutor } from '../../db';
import type { DbTransaction } from '../../db/types';
import { cmsDeployments, cmsSiteGenerations, type CmsDeploymentSnapshot } from '../../db/schema';
import { cmsGenerationContext, withCmsGenerationContext } from './cms-generation-context';
import { CMS_STATIC_ROOT, isStrictlyWithin } from './cms-static-path';
import { canonicalCmsJson } from './cms-content-revisions.service';
import type { CmsConfigurationSnapshot } from '@zenith/shared/cms';
import { CMS_PUBLIC_SITE_SETTINGS, CMS_CONFIGURATION_TABLES } from './cms-public-settings';

/** Only publication definitions are copied. Sessions, permissions, submissions and telemetry remain live. */
const SITE_TABLES = [
  'cms_channels', 'cms_contents', 'cms_tags', 'cms_resources', 'cms_resource_folders',
  'cms_pages', 'cms_widgets', 'cms_widget_refs', 'cms_widget_source_refs',
  'cms_friend_link_groups', 'cms_friend_links', 'cms_link_words', 'cms_redirects', 'cms_search_words',
  'cms_asset_versions',
] as const;
const GLOBAL_DEFINITION_TABLES = ['cms_sites', 'cms_site_inheritances', 'cms_models', 'cms_model_fields', 'cms_model_versions'] as const;
const CONTENT_RELATION_TABLES = ['cms_content_tags', 'cms_content_channels', 'cms_content_relations'] as const;
export const CMS_GENERATION_TABLES = [...GLOBAL_DEFINITION_TABLES, ...SITE_TABLES, ...CONTENT_RELATION_TABLES] as const;

export function cmsGenerationSchemaName(id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid CMS generation id');
  return `cms_generation_${id}`;
}
function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error('Invalid CMS projection identifier');
  return `"${value}"`;
}

/** All identifiers come from a closed list or a server-generated positive database id. */
export async function createCmsGenerationStorage(tx: DbTransaction, siteId: number, generationId: number, baseGenerationId?: number | null, configuration: CmsConfigurationSnapshot = { tables: {}, replaceAll: [] }): Promise<void> {
  const schema = identifier(cmsGenerationSchemaName(generationId));
  await tx.execute(sql.raw(`CREATE SCHEMA ${schema}`));
  for (const table of CMS_GENERATION_TABLES) {
    const name = identifier(table);
    await tx.execute(sql.raw(`CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`));
    const columns = await tx.execute<{ name: string }>(sql`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND is_generated = 'NEVER'
      ORDER BY ordinal_position
    `);
    const names = columns.map((column) => identifier(column.name)).join(',');
    const selected = columns.map((column) => table === 'cms_sites' && column.name === 'settings'
      ? `jsonb_strip_nulls(jsonb_build_object(${CMS_PUBLIC_SITE_SETTINGS.map((key) => `'${key}', settings->'${key}'`).join(',')}))`
      : identifier(column.name)).join(',');
    const scope = (GLOBAL_DEFINITION_TABLES as readonly string[]).includes(table)
      ? sql``
      : (CONTENT_RELATION_TABLES as readonly string[]).includes(table)
        ? sql` WHERE content_id IN (SELECT id FROM public.cms_contents WHERE site_id = ${siteId})`
        : sql` WHERE site_id = ${siteId}`;
    const configTable = (CMS_CONFIGURATION_TABLES as readonly string[]).includes(table);
    const source = baseGenerationId && configTable ? `${identifier(cmsGenerationSchemaName(baseGenerationId))}.${table === 'cms_sites' ? 'cms_site_projection' : table === 'cms_resources' ? 'cms_resource_projection' : name}` : `public.${name}`;
    if (baseGenerationId || !['cms_pages', 'cms_widgets', 'cms_widget_refs', 'cms_widget_source_refs'].includes(table)) {
      await tx.execute(sql`${sql.raw(`INSERT INTO ${schema}.${name} (${names}) OVERRIDING SYSTEM VALUE SELECT ${selected} FROM ${source}`)}${scope}`);
    }
    const frozen = configuration.tables[table];
    if (configTable && frozen) {
      if (configuration.replaceAll.includes(table)) await tx.execute(sql.raw(`DELETE FROM ${schema}.${name}`));
      else if (table === 'cms_widget_refs' && configuration.pageIds?.length) await tx.execute(sql`DELETE FROM ${sql.raw(`${schema}.${name}`)} WHERE owner_type='page' AND owner_id IN (${sql.join(configuration.pageIds.map((id) => sql`${id}`), sql`,`)})`);
      else if (table === 'cms_widget_source_refs' && configuration.widgetIds?.length) await tx.execute(sql`DELETE FROM ${sql.raw(`${schema}.${name}`)} WHERE widget_id IN (${sql.join(configuration.widgetIds.map((id) => sql`${id}`), sql`,`)})`);
      else if (frozen.length) await tx.execute(sql`DELETE FROM ${sql.raw(`${schema}.${name}`)} WHERE id IN (${sql.join(frozen.map((row) => sql`${Number(row.id)}`), sql`,`)})`);
      const removedIds = configuration.deleteIds?.[table] ?? [];
      if (removedIds.length) await tx.execute(sql`DELETE FROM ${sql.raw(`${schema}.${name}`)} WHERE id IN (${sql.join(removedIds.map((id) => sql`${id}`), sql`,`)})`);
      if (frozen.length) await tx.execute(sql`INSERT INTO ${sql.raw(`${schema}.${name} (${names})`)} OVERRIDING SYSTEM VALUE SELECT ${sql.raw(names)} FROM jsonb_populate_recordset(NULL::${sql.raw(`public.${name}`)}, ${JSON.stringify(frozen)}::jsonb)`);
    }
    if (table === 'cms_sites') {
      await tx.execute(sql.raw(`ALTER TABLE ${schema}.cms_sites RENAME TO cms_site_projection`));
      const projection = columns.map((column) => column.name === 'settings'
        ? `p.settings || coalesce((SELECT jsonb_build_object('captchaEnabled',live.settings->'captchaEnabled','indexNowKey',live.settings->'indexNowKey') FROM public.cms_sites live WHERE live.id=p.id),'{}'::jsonb) AS settings`
        : `p.${identifier(column.name)}`).join(',');
      await tx.execute(sql.raw(`CREATE VIEW ${schema}.cms_sites AS SELECT ${projection} FROM ${schema}.cms_site_projection p`));
    }
  }
}

export async function withCmsGenerationTransaction<T>(
  siteId: number, generationId: number, candidate: boolean, fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(generationId)},public`}, true)`);
    await tx.execute(sql`select set_config('cms.preview', ${candidate ? 'true' : 'false'}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '60000', true)`);
    return withDbExecutor(tx, () => withCmsGenerationContext({ siteId, generationId, candidate }, () => fn(tx)));
  }, { isolationLevel: 'repeatable read', ...(candidate ? {} : { accessMode: 'read only' as const }) });
}

/** Capture the pointer and all public reads in one MVCC snapshot. No streaming response is held here. */
export async function withCmsPublicGeneration<T>(siteId: number, fn: () => Promise<T>): Promise<T> {
  if (cmsGenerationContext()) return fn();
  return db.transaction(async (tx) => {
    const [pointer] = await tx.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, siteId)).limit(1);
    if (!pointer?.activeGenerationId) return withDbExecutor(tx, fn);
    const generationId = pointer.activeGenerationId;
    await tx.execute(sql`select set_config('search_path', ${`${cmsGenerationSchemaName(generationId)},public`}, true)`);
    await tx.execute(sql`select set_config('statement_timeout', '15000', true)`);
    return withDbExecutor(tx, () => withCmsGenerationContext({ siteId, generationId, candidate: false }, fn));
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/** Seal projections: content queries apply the live, fail-closed emergency withdrawal overlay. */
export async function sealCmsGenerationStorage(tx: DbTransaction, generationId: number, revisions: CmsDeploymentSnapshot['revisions']): Promise<void> {
  const schema = identifier(cmsGenerationSchemaName(generationId));
  await tx.execute(sql.raw(`CREATE TABLE ${schema}.cms_generation_revision_refs (content_id integer PRIMARY KEY, revision_id integer NOT NULL, hash varchar(64) NOT NULL)`));
  for (let start = 0; start < revisions.length; start += 500) {
    const batch = revisions.slice(start, start + 500);
    await tx.execute(sql`INSERT INTO ${sql.raw(schema)}.cms_generation_revision_refs (content_id,revision_id,hash) VALUES ${sql.join(batch.map((revision) => sql`(${revision.contentId},${revision.revisionId},${revision.hash})`), sql`,`)}`);
  }
  await tx.execute(sql.raw(`ALTER TABLE ${schema}.cms_contents RENAME TO cms_content_projection`));
  await tx.execute(sql.raw(`ALTER TABLE ${schema}.cms_resources RENAME TO cms_resource_projection`));
  await tx.execute(sql.raw(`CREATE VIEW ${schema}.cms_resources AS SELECT resource.* FROM ${schema}.cms_resource_projection resource WHERE NOT EXISTS (SELECT 1 FROM public.cms_asset_rights rights WHERE rights.resource_id=resource.id AND (rights.revoked OR rights.expires_at<=now()))`));
  const columns = await tx.execute<{ name: string }>(sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='cms_contents' ORDER BY ordinal_position`);
  const projection = columns.map(({ name }) => {
    if (name === 'status') return `CASE WHEN identity.id IS NULL OR identity.deleted_at IS NOT NULL OR (identity.status <> 'published' AND coalesce(current_setting('cms.preview',true),'false')<>'true') OR suppression.content_id IS NOT NULL OR asset_guard.blocked THEN 'offline'::public.cms_content_status ELSE content.status END AS status`;
    if (['archived_at', 'deleted_at', 'locked_at', 'locked_by', 'lock_reason', 'version'].includes(name)) return `identity.${identifier(name)} AS ${identifier(name)}`;
    if (name === 'updated_at') return `greatest(content.updated_at,identity.updated_at,suppression.updated_at,asset_guard.changed_at,(SELECT activated_at FROM public.cms_deployments WHERE id=${generationId}),CASE WHEN content.expire_at<=now() THEN content.expire_at END) AS updated_at`;
    if (['view_count', 'like_count', 'favorite_count'].includes(name)) return `coalesce(identity.${identifier(name)},content.${identifier(name)}) AS ${identifier(name)}`;
    return `content.${identifier(name)}`;
  }).join(',');
  await tx.execute(sql.raw(`CREATE VIEW ${schema}.cms_contents AS
    SELECT ${projection} FROM ${schema}.cms_content_projection content
    LEFT JOIN public.cms_contents identity ON identity.id=content.id
    LEFT JOIN public.cms_content_suppressions suppression ON suppression.content_id=content.id
    LEFT JOIN LATERAL (
      SELECT coalesce(bool_or(rights.revoked=true OR rights.expires_at<=now()),false) AS blocked,
        greatest(max(rights.updated_at),max(CASE WHEN rights.expires_at<=now() THEN rights.expires_at END)) AS changed_at
      FROM ${schema}.cms_generation_revision_refs revision_ref
      INNER JOIN public.cms_content_revisions revision ON revision.id=revision_ref.revision_id
      CROSS JOIN LATERAL jsonb_object_keys(coalesce(revision.snapshot->'assetVersions','{}'::jsonb)) asset(resource_id)
      INNER JOIN public.cms_asset_rights rights ON rights.resource_id=asset.resource_id::integer
      WHERE revision_ref.content_id=content.id
    ) asset_guard ON true`));
}

/** A runtime withdrawal/expiry invalidates aggregate static HTML as well as the detail route. */
export async function cmsGenerationNeedsDynamicDelivery(siteId: number): Promise<boolean> {
  const context = cmsGenerationContext();
  if (!context) return false;
  const schema = identifier(cmsGenerationSchemaName(context.generationId));
  const rows = await db.execute<{ blocked: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${sql.raw(schema)}.cms_content_projection p
      WHERE p.status='published' AND (
        p.expire_at<=now() OR p.top_expire_at<=now()
        OR EXISTS (SELECT 1 FROM public.cms_contents current_content WHERE current_content.id=p.id AND current_content.archived_at IS DISTINCT FROM p.archived_at)
        OR NOT EXISTS (SELECT 1 FROM ${sql.raw(schema)}.cms_contents visible WHERE visible.id=p.id AND visible.status='published')
      )
    ) OR EXISTS (SELECT 1 FROM public.cms_content_suppressions WHERE site_id=${siteId})
    OR EXISTS (SELECT 1 FROM public.cms_asset_rights rights JOIN ${sql.raw(schema)}.cms_resource_projection resource ON resource.id=rights.resource_id WHERE rights.revoked OR rights.expires_at<=now()) AS blocked
  `);
  return rows[0]?.blocked === true;
}

export async function cmsGenerationManifest(tx: DbTransaction, generationId: number, revisions: CmsDeploymentSnapshot['revisions']): Promise<{ snapshot: CmsDeploymentSnapshot; hash: string }> {
  const schema = identifier(cmsGenerationSchemaName(generationId));
  const tables: CmsDeploymentSnapshot['tables'] = {};
  for (const table of CMS_GENERATION_TABLES) {
    const rows = await tx.execute<{ count: string; hash: string }>(sql.raw(
      `SELECT count(*)::text AS count, md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM ${schema}.${identifier(table === 'cms_sites' ? 'cms_site_projection' : table)} t`,
    ));
    tables[table] = [{ count: Number(rows[0]?.count ?? 0), hash: rows[0]?.hash ?? '' }];
  }
  const snapshot: CmsDeploymentSnapshot = { tables, revisions, sitePublicRevision: 0, createdAt: new Date().toISOString() };
  return { snapshot, hash: createHash('sha256').update(JSON.stringify({ tables, revisions })).digest('hex') };
}
export function hashCmsDeploymentManifest(snapshot: CmsDeploymentSnapshot): string {
  return createHash('sha256').update(canonicalCmsJson(snapshot)).digest('hex');
}

export async function collectCmsGenerationArtifacts(siteCode: string, generationId: number): Promise<NonNullable<CmsDeploymentSnapshot['artifacts']>> {
  cmsGenerationSchemaName(generationId);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(siteCode)) throw new Error('Invalid CMS site code');
  const root = path.resolve(CMS_STATIC_ROOT, siteCode, `generation-${generationId}`);
  if (!isStrictlyWithin(CMS_STATIC_ROOT, root)) throw new Error('Invalid generation artifact path');
  const artifacts: NonNullable<CmsDeploymentSnapshot['artifacts']> = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Publication artifacts cannot contain symbolic links');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(file);
        artifacts.push({ path: path.relative(root, file).replaceAll('\\', '/'), checksum: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
      }
    }
  };
  await walk(root);
  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}
export async function verifyCmsGenerationArtifacts(generationId: number, snapshot: CmsDeploymentSnapshot): Promise<void> {
  if (!snapshot.siteCode || !snapshot.artifacts?.length) throw new Error('部署缺少完整产物清单');
  const actual = await collectCmsGenerationArtifacts(snapshot.siteCode, generationId);
  if (canonicalCmsJson(actual) !== canonicalCmsJson(snapshot.artifacts)) throw new Error('部署产物缺失或校验和变化，拒绝激活');
}

export async function dropFailedCmsGenerationStorage(generationId: number): Promise<void> {
  const [deployment] = await db.select().from(cmsDeployments).where(eq(cmsDeployments.id, generationId)).limit(1);
  if (!deployment || deployment.status !== 'failed') return;
  const [active] = await db.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.activeGenerationId, generationId)).limit(1);
  if (active) throw new Error('Cannot remove an active CMS generation');
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${identifier(cmsGenerationSchemaName(generationId))} CASCADE`));
}
