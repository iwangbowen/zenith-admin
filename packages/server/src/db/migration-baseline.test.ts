import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readMigration = (path: string) => readFileSync(new URL(`../../drizzle/${path}`, import.meta.url), 'utf8');
const baseline = readMigration('0000_baseline.sql');
const extensions = readMigration('0001_extensions.sql');

describe('空库迁移基准', () => {
  it.each([
    ['iot_telemetry', 'reported_at'],
    ['drive_activities', 'created_at'],
    ['drive_share_access_logs', 'created_at'],
  ])('%s 直接创建 RANGE 父表，扩展迁移只初始化子分区', (table, column) => {
    const statement = baseline.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\)[^;]*;`, 'g'));
    expect(statement).toHaveLength(1);
    expect(statement?.[0]).toContain(`PARTITION BY RANGE ("${column}")`);
    expect(extensions).not.toMatch(new RegExp(`(?:DROP TABLE(?: IF EXISTS)?|CREATE TABLE) "${table}"`));
    expect(extensions).toContain(`PARTITION OF "${table}"`);
  });

  it('trigram 扩展先于依赖它的索引创建', () => {
    const extensionIndex = baseline.indexOf('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    expect(extensionIndex).toBeGreaterThanOrEqual(0);
    expect(baseline.indexOf('gin_trgm_ops')).toBeGreaterThan(extensionIndex);
  });

  it('唯一索引先于引用其列的外键创建', () => {
    const firstForeignKey = baseline.search(/ALTER TABLE [^;]+ FOREIGN KEY/);
    expect(firstForeignKey).toBeGreaterThan(0);
    for (const index of baseline.matchAll(/CREATE UNIQUE INDEX/g)) {
      expect(index.index).toBeLessThan(firstForeignKey);
    }
  });
});
