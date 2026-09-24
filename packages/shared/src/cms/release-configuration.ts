import type { CmsConfigurationSnapshot } from './release-validation';

/** Pending configuration is a working publication draft. Newer captures replace
 * the same objects, preserve unrelated edits, and retain explicit deletions. */
export function mergeCmsConfigurationSnapshots(previous: CmsConfigurationSnapshot, incoming: CmsConfigurationSnapshot): CmsConfigurationSnapshot {
  const merged = structuredClone(previous);
  merged.deleteIds ??= {};
  const key = (row: Record<string, unknown>) => String(row.id ?? row.site_id);
  for (const [table, additions] of Object.entries(incoming.tables)) {
    if (incoming.replaceAll.includes(table)) {
      merged.tables[table] = structuredClone(additions);
      merged.deleteIds[table] = [...(incoming.deleteIds?.[table] ?? [])];
      continue;
    }
    const deleted = new Set(incoming.deleteIds?.[table] ?? []);
    const retained = (merged.tables[table] ?? []).filter((row) => !deleted.has(Number(row.id))
      && !(table === 'cms_widget_refs' && row.owner_type === 'page' && incoming.pageIds?.includes(Number(row.owner_id)))
      && !(table === 'cms_widget_source_refs' && incoming.widgetIds?.includes(Number(row.widget_id))));
    const byId = new Map(retained.map((row) => [key(row), row]));
    for (const row of additions) byId.set(key(row), structuredClone(row));
    merged.tables[table] = [...byId.values()];
    const restored = new Set(additions.map((row) => Number(row.id)));
    merged.deleteIds[table] = [...new Set([...(merged.deleteIds[table] ?? []), ...deleted])].filter((id) => !restored.has(id));
  }
  merged.replaceAll = [...new Set([...previous.replaceAll, ...incoming.replaceAll])];
  merged.pageIds = [...new Set([...(previous.pageIds ?? []), ...(incoming.pageIds ?? [])])];
  merged.widgetIds = [...new Set([...(previous.widgetIds ?? []), ...(incoming.widgetIds ?? [])])];
  merged.assetVersions = { ...previous.assetVersions, ...incoming.assetVersions };
  const referencedAssets = new Set([...JSON.stringify(merged.tables).matchAll(/cms-res:\/\/(\d+)/g)].map((match) => match[1]));
  merged.assetVersions = Object.fromEntries(Object.entries(merged.assetVersions).filter(([id]) => referencedAssets.has(id)));
  return merged;
}
