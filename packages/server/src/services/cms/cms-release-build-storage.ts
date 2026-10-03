import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, withDbExecutor, withoutDbExecutor } from '../../db';
import type { DbTransaction } from '../../db/types';
import logger from '../../lib/logger';
import { cmsGenerationSchemaName, CMS_GENERATION_TABLES } from './cms-generation-storage.service';
import { assertNoExternalCmsSchemaDependencies } from './cms-deployment-storage-state';
import { withCmsGenerationContext } from './cms-generation-context';
import { readCmsGenerationDelivery } from './cms-generation-delivery';
import { cmsBuildDigest, type CmsBuildTarget, type CmsBuildContentDependencies } from './cms-release-build-artifacts';
import { canonicalCmsJson } from './cms-content-revisions.service';
import { resolveCmsThemeSlotsForRender } from './cms-widgets.service';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { cmsRenderRuntimeHashFromEntry } from './cms-render-runtime';

const RENDER_RUNTIME_TABLES = ['cms_comments', 'cms_ad_slots', 'cms_ads', 'cms_forms', 'cms_interactions', 'cms_interaction_questions', 'cms_asset_rights', 'dicts', 'dict_items'] as const;
export function cmsBuildSchema(id: number): string { return `${cmsGenerationSchemaName(id)}_build`; }

/** Runtime rows affect HTML, but remain live for public requests. Only build reads use these copies. */
export async function createCmsBuildStorage(tx: DbTransaction, siteId: number, id: number): Promise<void> {
  const generation = cmsGenerationSchemaName(id);
  const schema = cmsBuildSchema(id);
  await tx.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
  await tx.execute(sql.raw(`CREATE TABLE "${schema}".cms_sites AS TABLE "${generation}".cms_sites`));
  await tx.execute(sql.raw(`CREATE UNIQUE INDEX cms_build_sites_id_idx ON "${schema}".cms_sites(id)`));
  // The view retains its dependency on the raw table when sealing renames that table.
  // Recovery and full/incremental parity checks therefore never read the live delivery overlay.
  await tx.execute(sql.raw(`CREATE VIEW "${schema}".cms_contents AS SELECT * FROM "${generation}".cms_contents`));
  await tx.execute(sql.raw(`CREATE VIEW "${schema}".cms_resources AS SELECT * FROM "${generation}".cms_resources`));
  for (const table of RENDER_RUNTIME_TABLES) {
    const scope = table === 'dicts' || table === 'dict_items' ? 'true'
      : table === 'cms_ads' ? `slot_id IN (SELECT id FROM public.cms_ad_slots WHERE site_id=${siteId})`
      : table === 'cms_interaction_questions' ? `interaction_id IN (SELECT id FROM public.cms_interactions WHERE site_id=${siteId})`
        : table === 'cms_asset_rights' ? `resource_id IN (SELECT id FROM public.cms_resources WHERE site_id=${siteId})`
          : `site_id=${siteId}`;
    await tx.execute(sql.raw(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`));
    await tx.execute(sql.raw(`INSERT INTO "${schema}"."${table}" OVERRIDING SYSTEM VALUE SELECT * FROM public."${table}" WHERE ${scope}`));
  }
  // A derived artifact index, not a task queue. Its primary key is the deterministic render target.
  await tx.execute(sql.raw(`CREATE TABLE "${generation}".cms_build_targets (key text PRIMARY KEY, fingerprint varchar(64) NOT NULL, artifacts jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now())`));
}

/**
 * Nothing reads the staging copy once its generation has gone live or been replaced. Failed builds keep it,
 * because resuming re-reads the frozen runtime rows; retention removes any leftover with the generation.
 */
export async function dropCmsBuildStorage(generationId: number): Promise<void> {
  const schema = cmsBuildSchema(generationId);
  try {
    await db.transaction(async (tx) => {
      const [ownership] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('cms-generation-build'), ${generationId}) AS acquired`);
      if (!ownership?.acquired) return;
      await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
      await assertNoExternalCmsSchemaDependencies(tx, [schema]);
      await tx.execute(sql`drop schema if exists ${sql.identifier(schema)} cascade`);
    });
  } catch (error) {
    logger.warn(`[CMS] 部署 ${generationId} 的构建暂存 schema 清理失败，将随保留策略回收`, error);
  }
}

export async function withCmsBuildTransaction<T>(siteId: number, generationId: number, buildAt: Date, fn: (tx: DbTransaction) => Promise<T>, isolationLevel: 'repeatable read' | 'read committed' = 'repeatable read'): Promise<T> {
  return db.transaction(async (tx) => {
    const [ownership] = await tx.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('cms-generation-build'), ${generationId}) AS acquired`);
    if (!ownership?.acquired) throw new Error('同一候选部署的前一执行轮次尚未退出，请稍后恢复');
    await tx.execute(sql`select set_config('search_path', ${`${cmsBuildSchema(generationId)},${cmsGenerationSchemaName(generationId)},public`}, true)`);
    await tx.execute(sql`select set_config('cms.preview','true',true)`);
    await tx.execute(sql`select set_config('statement_timeout','60000',true)`);
    const delivery = await readCmsGenerationDelivery(tx, siteId, generationId, true);
    return withDbExecutor(tx, () => withCmsGenerationContext({ siteId, generationId, candidate: true, buildAt, ...delivery }, () => fn(tx)));
  }, { isolationLevel });
}

/** The coordinator owns the build lock; each parallel target gets a separate frozen read connection. */
export async function withCmsBuildReadTransaction<T>(siteId: number, generationId: number, buildAt: Date, fn: () => Promise<T>): Promise<T> {
  return withoutDbExecutor(() => db.transaction(async tx => {
    await tx.execute(sql`select set_config('search_path', ${`${cmsBuildSchema(generationId)},${cmsGenerationSchemaName(generationId)},public`}, true), set_config('cms.preview','true',true), set_config('statement_timeout','60000',true)`);
    const delivery = await readCmsGenerationDelivery(tx, siteId, generationId, true);
    return withDbExecutor(tx, () => withCmsGenerationContext({ siteId, generationId, candidate: true, buildAt, ...delivery }, fn));
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' }));
}

export async function loadCmsBuildTargets(generationId: number): Promise<Map<string, CmsBuildTarget>> {
  const schema = cmsGenerationSchemaName(generationId);
  const exists = await db.execute<{ present: string | null }>(sql`SELECT to_regclass(${`${schema}.cms_build_targets`})::text AS present`);
  if (!exists[0]?.present) return new Map();
  const rows = await db.execute<{ key: string; fingerprint: string; artifacts: CmsBuildTarget['artifacts'] }>(sql.raw(`SELECT key,fingerprint,artifacts FROM "${schema}".cms_build_targets ORDER BY key`));
  return new Map(rows.map((target) => [target.key, target]));
}

export async function saveCmsBuildTarget(tx: DbTransaction, generationId: number, target: CmsBuildTarget): Promise<void> {
  return saveCmsBuildTargets(tx, generationId, [target]);
}
export async function saveCmsBuildTargets(tx: DbTransaction, generationId: number, targets: readonly CmsBuildTarget[]): Promise<void> {
  if (!targets.length) return;
  const schema = cmsGenerationSchemaName(generationId);
  await tx.execute(sql`INSERT INTO ${sql.raw(`"${schema}".cms_build_targets`)} (key,fingerprint,artifacts) VALUES ${sql.join(targets.map(target => sql`(${target.key},${target.fingerprint},${JSON.stringify(target.artifacts)}::jsonb)`), sql`,`)}
    ON CONFLICT (key) DO UPDATE SET fingerprint=excluded.fingerprint,artifacts=excluded.artifacts,completed_at=now()`);
}

/** Hash renderer modules and themes, without invalidating every page for unrelated backend changes. */
export async function cmsBuildRuntimeHash(): Promise<string> {
  return cmsRenderRuntimeHashFromEntry(fileURLToPath(import.meta.url));
}

/** Broad dependency closure is intentional: home, menus, collections, related links and media cross pages. */
export async function cmsBuildDependencyHashes(tx: DbTransaction, generationId: number, buildAt: Date, runtimeHash: string): Promise<{ global: string; pages: Map<number, string>; contents?: CmsBuildContentDependencies }> {
  const schema = cmsGenerationSchemaName(generationId);
  const runtime = cmsBuildSchema(generationId);
  const tables: Array<[string, string]> = [];
  const [site] = await tx.execute<{ id: number; theme: string }>(sql`SELECT id,theme FROM ${sql.raw(`"${runtime}".cms_sites`)} WHERE id=(SELECT site_id FROM public.cms_deployments WHERE id=${generationId})`);
  const effectiveSite = await withDbExecutor(tx, () => resolveEffectiveCmsSiteRow(site.id));
  const preciseDefault = effectiveSite.theme === 'default';
  for (const table of CMS_GENERATION_TABLES) {
    if (preciseDefault && (table === 'cms_contents' || table === 'cms_asset_versions')) continue;
    const source = ['cms_sites', 'cms_contents', 'cms_resources'].includes(table) ? `"${runtime}"."${table}"` : `"${schema}"."${table}"`;
    // An independent page body cannot influence other pages; its public URL and visibility can.
    const value = table === 'cms_pages'
      ? `CASE WHEN t.is_home THEN to_jsonb(t) ELSE jsonb_build_object('id',t.id,'site_id',t.site_id,'name',t.name,'path',t.path,'slug',t.slug,'status',t.status,'is_home',t.is_home,'requires_dynamic',t.requires_dynamic) END`
      : table === 'cms_contents' ? `to_jsonb(t)-'search_vector'` : preciseDefault && table === 'cms_tags' ? `to_jsonb(t)-ARRAY['updated_at','updated_by']::text[]` : 'to_jsonb(t)';
    const rows = await tx.execute<{ hash: string }>(sql.raw(`SELECT md5(coalesce(string_agg(md5((${value})::text),'' ORDER BY md5((${value})::text)),'')) AS hash FROM ${source} t`));
    tables.push([table, rows[0].hash]);
  }
  for (const table of RENDER_RUNTIME_TABLES) {
    const rows = await tx.execute<{ hash: string }>(sql.raw(`SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash FROM "${runtime}"."${table}" t`));
    tables.push([table, rows[0].hash]);
  }
  // A clock boundary can alter ranking, visibility or footer dates even with identical persisted rows.
  const transitions = await tx.execute<{ hash: string }>(sql`SELECT md5(coalesce(string_agg(id::text || ':' || coalesce((expire_at<=${buildAt.toISOString()}::timestamptz)::text,'none') || ':' || coalesce((top_expire_at<=${buildAt.toISOString()}::timestamptz)::text,'none'),',' ORDER BY id),'')) AS hash FROM ${sql.raw(`"${runtime}".cms_contents`)}`);
  const windows: string[] = [];
  for (const table of ['cms_ads', 'cms_interactions'] as const) {
    const rows = await tx.execute<{ hash: string }>(sql`SELECT md5(coalesce(string_agg(id::text || ':' || coalesce((start_at<=${buildAt.toISOString()}::timestamptz)::text,'none') || ':' || coalesce((end_at<=${buildAt.toISOString()}::timestamptz)::text,'none'),',' ORDER BY id),'')) AS hash FROM ${sql.raw(`"${runtime}"."${table}"`)}`);
    windows.push(rows[0].hash);
  }
  const rights = await tx.execute<{ hash: string }>(sql`SELECT md5(coalesce(string_agg(resource_id::text || ':' || coalesce((expires_at<=${buildAt.toISOString()}::timestamptz)::text,'none'),',' ORDER BY resource_id),'')) AS hash FROM ${sql.raw(`"${runtime}".cms_asset_rights`)}`);
  const pages = await tx.execute<{ id: number; hash: string }>(sql.raw(`SELECT id,md5(to_jsonb(t)::text) AS hash FROM "${schema}".cms_pages t`));
  let contents: CmsBuildContentDependencies | undefined;
  if (preciseDefault) {
    // Default detail reads other content only as links (adjacent/manual-related/shared-tag results).
    // Hashing the complete link catalogue conservatively includes membership and sort changes,
    // without coupling unrelated details to another article's body, excerpt or model fields.
    const linkColumns = ['id', 'site_id', 'channel_id', 'title', 'slug', 'static_path', 'external_link', 'published_at', 'created_at', 'status', 'deleted_at', 'archived_at', 'expire_at'];
    const linkValue = `jsonb_build_array(${linkColumns.map((column) => `t.${column}`).join(',')})`;
    const [links] = await tx.execute<{ hash: string }>(sql.raw(`SELECT md5(coalesce(string_agg(md5((${linkValue})::text),'' ORDER BY id),'')) AS hash FROM "${runtime}".cms_contents t`));
    tables.push(['default-content-link-catalogue', links.hash]);
    // Slots are signed from the actual resolved values after source fallbacks/overrides, so a
    // source excerpt change invalidates details only when a visible theme widget consumes it.
    const slots = await withDbExecutor(tx, () => resolveCmsThemeSlotsForRender(site.id, 'default', ''));
    tables.push(['default-resolved-theme-slots', cmsBuildDigest(canonicalCmsJson(slots))]);
    const listColumns = ['id', 'site_id', 'channel_id', 'model_id', 'model_version_id', 'title', 'title_style', 'slug', 'static_path', 'external_link', 'content_type', 'cover_image', 'author', 'source', 'published_at', 'created_at', 'view_count', 'like_count', 'favorite_count', 'is_top', 'top_weight', 'is_recommend', 'is_hot', 'sort', 'status', 'deleted_at', 'archived_at', 'expire_at', 'top_expire_at', 'media_data'];
    const listExtend = `CASE WHEN t.model_id IS NULL THEN '{}'::jsonb WHEN t.model_version_id IS NOT NULL THEN coalesce((SELECT jsonb_object_agg(field->>'name',t.extend->(field->>'name')) FROM "${schema}".cms_model_versions version CROSS JOIN LATERAL jsonb_array_elements(version.fields) field WHERE version.id=t.model_version_id AND field->>'showInList'='true'),'{}'::jsonb) ELSE coalesce((SELECT jsonb_object_agg(field.name,t.extend->field.name) FROM "${schema}".cms_model_fields field WHERE field.model_id=t.model_id AND field.show_in_list),'{}'::jsonb) END`;
    const listMedia = `coalesce((SELECT jsonb_object_agg(media.key,media.value) FROM jsonb_each(t.media) media WHERE media.key=t.cover_image OR position(media.key in (${listExtend})::text)>0),'{}'::jsonb)`;
    const listValue = `jsonb_build_array(${listColumns.map((column) => `t.${column}`).join(',')}, CASE WHEN nullif(btrim(t.summary),'') IS NOT NULL THEN t.summary ELSE left(nullif(btrim(t.excerpt),''),120) END,${listExtend},${listMedia})`;
    const [collection] = await tx.execute<{ hash: string }>(sql.raw(`SELECT md5(coalesce(string_agg(md5((${listValue})::text),'' ORDER BY id),'')) AS hash FROM "${runtime}".cms_contents t`));
    const detailRows = await tx.execute<{ id: number; hash: string }>(sql.raw(`SELECT id,md5((to_jsonb(t)-'search_vector')::text) AS hash FROM "${runtime}".cms_contents t`));
    contents = { collections: collection.hash, details: new Map(detailRows.map((row) => [row.id, row.hash])) };
  }
  return { global: cmsBuildDigest([runtimeHash, tables, buildAt.toISOString().slice(0, 10), transitions[0].hash, windows, rights[0].hash]), pages: new Map(pages.map((page) => [page.id, page.hash])), contents };
}
