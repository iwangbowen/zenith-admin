import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsConfigurationSnapshot, CmsRelease, CmsPublishSubmitInput } from '@zenith/shared/cms';
import type { DbTransaction } from '../../db/types';
import { CMS_CONFIGURATION_TABLES, CMS_PUBLIC_SITE_SETTINGS } from './cms-public-settings';
import { extractCmsResourceIds, resolveCmsResourceUris } from '../../lib/cms-resource-uri';
import { ensureCmsAssetVersion } from './cms-design-versions.service';
import { isCmsRevisionAssetVisible } from './cms-asset-rights.service';
export interface CmsCapturedConfiguration { snapshot: CmsConfigurationSnapshot; items: CmsRelease['configurationItems']; baseGenerationId: number | null }

export function cmsConfigurationSelection(input: Pick<CmsPublishSubmitInput, 'targetType' | 'pageId'>) {
  return input.targetType === 'page' && input.pageId
    ? { pageIds: [input.pageId], widgetIds: [], includeSiteConfiguration: false, allowDeletedSelection: true }
    : { pageIds: [], widgetIds: [], includeSiteConfiguration: !['content', 'contents'].includes(input.targetType) };
}
export async function captureCmsConfiguration(tx: DbTransaction, siteId: number, options: { pageIds?: number[]; widgetIds?: number[]; includeSiteConfiguration?: boolean; allowDeletedSelection?: boolean; configurationTables?: readonly string[] }) {
  const pageIds = [...new Set(options.pageIds ?? [])];
  const widgetIds = [...new Set(options.widgetIds ?? [])];
  const all = options.includeSiteConfiguration === true;
  const snapshot: CmsConfigurationSnapshot = { tables: {}, replaceAll: [], pageIds, widgetIds, deleteIds: {} };
  const items: CmsRelease['configurationItems'] = [];
  for (const table of CMS_CONFIGURATION_TABLES) {
    const wholeTable = all || options.configurationTables?.includes(table) === true;
    if (!wholeTable && !(table === 'cms_pages' && pageIds.length) && !(table === 'cms_widgets' && widgetIds.length)
      && !(table === 'cms_widget_refs' && pageIds.length) && !(table === 'cms_widget_source_refs' && widgetIds.length)) continue;
    const scope = table === 'cms_sites' || table === 'cms_site_inheritances' ? sql`` : sql` WHERE t.site_id=${siteId}`;
    const selection = !all && table === 'cms_pages' ? sql` AND t.id IN (${sql.join(pageIds.map((id) => sql`${id}`), sql`,`)})`
      : !all && table === 'cms_widgets' ? sql` AND t.id IN (${sql.join(widgetIds.map((id) => sql`${id}`), sql`,`)})`
      : !all && table === 'cms_widget_refs' ? sql` AND t.owner_type='page' AND t.owner_id IN (${sql.join(pageIds.map((id) => sql`${id}`), sql`,`)})`
      : !all && table === 'cms_widget_source_refs' ? sql` AND t.widget_id IN (${sql.join(widgetIds.map((id) => sql`${id}`), sql`,`)})` : sql``;
    const projection = table === 'cms_sites'
      ? sql.raw(`to_jsonb(t) || jsonb_build_object('settings', jsonb_strip_nulls(jsonb_build_object(${CMS_PUBLIC_SITE_SETTINGS.map((key) => `'${key}',t.settings->'${key}'`).join(',')})))`)
      : sql.raw('to_jsonb(t)');
    const rows = await tx.execute<{ row: Record<string, unknown> }>(sql`SELECT ${projection} AS row FROM ${sql.raw(`public.${table}`)} t${scope}${selection}`);
    snapshot.tables[table] = rows.map((entry) => entry.row);
    if (wholeTable) snapshot.replaceAll.push(table);
    if (table === 'cms_pages' || table === 'cms_widgets') {
      const expected = table === 'cms_pages' ? pageIds : widgetIds;
      if (!all && rows.length !== expected.length && !options.allowDeletedSelection) throw new HTTPException(404, { message: '所选页面或部件不存在或不属于本站' });
      if (!all) snapshot.deleteIds![table] = expected.filter((id) => !rows.some(({ row }) => Number(row.id) === id));
      items.push(...rows.map(({ row }) => ({ kind: table === 'cms_pages' ? 'page' as const : 'widget' as const, id: Number(row.id), title: String(row.name) })));
      items.push(...(snapshot.deleteIds![table] ?? []).map((id) => ({ kind: table === 'cms_pages' ? 'page' as const : 'widget' as const, id, title: `删除 #${id}` })));
    }
  }
  if (all) items.unshift({ kind: 'site', id: siteId, title: '整站公开配置与导航' });
  else if (options.configurationTables?.length) items.unshift({ kind: 'site', id: siteId, title: '所选站点公开配置' });
  const siteRows = snapshot.tables.cms_sites ?? [];
  const chain = new Set<number>();
  let current = siteRows.find((row) => Number(row.id) === siteId);
  while (current && !chain.has(Number(current.id))) {
    chain.add(Number(current.id));
    current = current.parent_id == null ? undefined : siteRows.find((row) => Number(row.id) === Number(current!.parent_id));
  }
  // Other sites are retained only as routing/language metadata; their assets are
  // not dependencies of this site's release. Ancestor dependencies remain explicit.
  if (siteRows.length) snapshot.tables.cms_sites = siteRows.map((row) => chain.has(Number(row.id)) ? row : resolveCmsResourceUris(row, () => null));
  const resourceIds = extractCmsResourceIds(snapshot.tables).sort((a, b) => a - b);
  if (resourceIds.length) {
    if (!all) {
      const resources = await tx.execute<{ row: Record<string, unknown> }>(sql`SELECT to_jsonb(resource) AS row FROM public.cms_resources resource WHERE site_id=${siteId} AND id IN (${sql.join(resourceIds.map((id) => sql`${id}`), sql`,`)})`);
      if (resources.length !== resourceIds.length) throw new HTTPException(409, { message: '选定配置包含不存在或跨站的素材' });
      snapshot.tables.cms_resources = resources.map((entry) => entry.row);
    }
    snapshot.assetVersions = {};
    for (const resourceId of resourceIds) {
      const version = await ensureCmsAssetVersion(tx, resourceId, siteId);
      snapshot.assetVersions[String(resourceId)] = version.id;
      const resource = snapshot.tables.cms_resources?.find((row) => Number(row.id) === resourceId);
      if (resource) Object.assign(resource, { url: version.url, thumb_url: version.thumbUrl, file_id: version.fileId, mime_type: version.mimeType, width: version.width, height: version.height, size: version.size });
    }
    if (!await isCmsRevisionAssetVisible(snapshot, tx)) throw new HTTPException(409, { message: '选定配置包含已撤权或过期素材' });
  }
  return { snapshot, items };
}
