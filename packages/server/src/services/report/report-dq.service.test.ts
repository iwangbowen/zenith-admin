import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import type { ReportDqRuleConfig } from '@zenith/shared/report';
import {
  boundFailureSamples,
  evaluateBuiltinDqRule,
  validateCustomDqSql,
} from './report-dq.service';

const rows = [
  { id: 1, name: 'Alice', score: 10, updatedAt: '2026-03-10 10:00:00' },
  { id: 2, name: '', score: 30, updatedAt: '2026-03-01 10:00:00' },
  { id: 2, name: null, score: 'bad', updatedAt: 'invalid' },
];

function evaluate(
  type: Parameters<typeof evaluateBuiltinDqRule>[0],
  field: string | null,
  config: ReportDqRuleConfig = {},
) {
  return evaluateBuiltinDqRule(type, rows, field, config, dayjs('2026-03-10 12:00:00'));
}

describe('report data-quality evaluators', () => {
  it('evaluates not-null, uniqueness, range and pattern rules', () => {
    expect(evaluate('not_null', 'name').failedCount).toBe(2);
    expect(evaluate('uniqueness', 'id').failedCount).toBe(2);
    expect(evaluate('range', 'score', { min: 0, max: 20 }).failedCount).toBe(2);
    expect(evaluate('pattern', 'name', { pattern: '^[A-Z][a-z]+$' }).failedCount).toBe(2);
  });

  it('evaluates freshness and row-count boundaries', () => {
    expect(evaluate('freshness', 'updatedAt', { maxAgeMinutes: 180 }).failedCount).toBe(2);
    expect(evaluate('row_count', null, { minRows: 4 }).failedCount).toBe(3);
    expect(evaluate('row_count', null, { minRows: 1, maxRows: 3 }).failedCount).toBe(0);
  });

  it('caps failure samples by rows and UTF-8 bytes', () => {
    const many = Array.from({ length: 150 }, (_, id) => ({ id, value: 'x'.repeat(100) }));
    expect(boundFailureSamples(many, 150, 1_000_000).rows).toHaveLength(100);
    const bounded = boundFailureSamples(many, 100, 512);
    expect(bounded.rows.length).toBeGreaterThan(0);
    expect(bounded.bytes).toBeLessThanOrEqual(512);
  });

  it('restricts custom SQL to the bound dataset CTE', () => {
    expect(validateCustomDqSql("select row from dataset where row->>'name' is null"))
      .toContain('dataset');
    expect(validateCustomDqSql("select d.row from dataset as d where lower(d.row->>'name') = 'alice'"))
      .toContain('dataset');
    expect(validateCustomDqSql("select row from dataset where (row->>'id')::int > 0"))
      .toContain('where');
    expect(() => validateCustomDqSql('select * from users')).toThrow('当前数据集');
    expect(() => validateCustomDqSql('select row from dataset d, users u')).toThrow('dataset');
    expect(() => validateCustomDqSql('select row from dataset where row->>\'id\' in (select id from users)')).toThrow('dataset');
    expect(() => validateCustomDqSql('select row from"users"')).toThrow('带引号');
    // query_to_xml 现已进入通用危险函数黑名单（report-sql-safety），在 DQ 专属校验之前即被拒绝
    expect(() => validateCustomDqSql("select row from dataset where query_to_xml('select * from users', true, true, '') is not null"))
      .toThrow(/未允许的函数|禁止的函数：query_to_xml/);
    expect(() => validateCustomDqSql('delete from dataset')).toThrow();
  });
});
