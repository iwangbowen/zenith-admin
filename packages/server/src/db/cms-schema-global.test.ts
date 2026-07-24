import { describe, expect, it } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as cmsSchema from './schema/cms';
import { cmsDistributionRules, cmsSiteInheritances, cmsSites, cmsThemeDeployments } from './schema/cms';

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
  it('keeps all 54 CMS tables outside tenant ownership', () => {
    const tables = cmsTables();
    expect(tables).toHaveLength(54);
    expect(tables.map((item) => item.name)).not.toEqual(expect.arrayContaining([
      'cms_surveys',
      'cms_survey_questions',
      'cms_survey_answers',
      'cms_polls',
      'cms_poll_votes',
    ]));
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
    expect(config.columns.find((column) => column.name === 'template_refs_revision')?.notNull).toBe(true);
    expect(config.columns.find((column) => column.name === 'parent_id')).toBeDefined();
    expect(config.indexes.find((item) => item.config.name === 'cms_sites_parent_idx')).toBeDefined();
  });

  it('stores explicit per-field inheritance and governed distribution without a CMS tenant', () => {
    const inheritance = getTableConfig(cmsSiteInheritances);
    expect(inheritance.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'seo_title',
      'static_mode',
      'review_mode',
      'webhook',
      'cdn',
      'theme',
      'theme_config',
      'templates',
    ]));
    const distribution = getTableConfig(cmsDistributionRules);
    expect(distribution.columns.find((column) => column.name === 'tenant_id')).toBeUndefined();
    expect(distribution.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'cms_distribution_rules_source_idx',
      'cms_distribution_rules_target_idx',
      'cms_distribution_rules_due_idx',
    ]));
  });

  it('allows at most one active theme deployment per site regardless of theme code', () => {
    const config = getTableConfig(cmsThemeDeployments);
    const activeIndex = config.indexes.find((item) => item.config.name === 'cms_theme_deployments_site_active_uq');
    expect(activeIndex?.config.unique).toBe(true);
    expect(activeIndex?.config.columns).toHaveLength(1);
    expect(activeIndex?.config.columns[0]).toMatchObject({ name: 'site_id' });
    expect(activeIndex?.config.where).toBeDefined();
  });
});
