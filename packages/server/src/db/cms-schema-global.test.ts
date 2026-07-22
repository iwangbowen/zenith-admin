import { describe, expect, it } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as cmsSchema from './schema/cms';
import { cmsSites } from './schema/cms';

function cmsTables(): { name: string; table: PgTable }[] {
  const tables: { name: string; table: PgTable }[] = [];
  for (const value of Object.values(cmsSchema)) {
    if (!value || typeof value !== 'object') continue;
    try {
      const config = getTableConfig(value as PgTable);
      if (config.name.startsWith('cms_')) tables.push({ name: config.name, table: value as PgTable });
    } catch {
      // Enums and non-table exports are intentionally ignored.
    }
  }
  return tables;
}

describe('global CMS schema', () => {
  it('keeps all 45 CMS tables outside tenant ownership', () => {
    const tables = cmsTables();
    expect(tables).toHaveLength(45);
    for (const { name, table } of tables) {
      const tenantColumn = getTableConfig(table).columns.find((column) => column.name === 'tenant_id');
      expect(tenantColumn, `${name} must not expose tenant_id`).toBeUndefined();
    }
  });

  it('enforces globally unique site codes and at most one global default site', () => {
    const config = getTableConfig(cmsSites);
    expect(config.columns.find((column) => column.name === 'code')?.isUnique).toBe(true);
    const defaultIndex = config.indexes.find((item) => item.config.name === 'cms_sites_default_uq');
    expect(defaultIndex?.config.unique).toBe(true);
    expect(defaultIndex?.config.where).toBeDefined();
  });
});
